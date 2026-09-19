/**
 * Harness for the true-audio QA suite (`test/e2e/qa-exhaustive.spec.ts`).
 *
 * The microphone is real as far as Chromium is concerned: a generated 16-bit
 * PCM WAV is streamed through `--use-file-for-fake-audio-capture`, the content
 * script sees a genuine Space keydown/keyup, and the offscreen document opens a
 * genuine `SpeechRecognition` session against that stream.
 *
 * KNOWN ENVIRONMENT LIMIT (probed, see state/NOTES.md N-014): Chromium's speech
 * service is network-dependent and unreliable on a synthetic voice. Depending on
 * the run it returned nothing, `no-speech`, or a wrong transcript ("play welcome
 * home" for "Book the 9:40 flight"); the on-device model never finishes
 * downloading. A test that acted on whatever it heard would be flaky and wrong, so
 * development builds honour a `qa.ignoreStt` flag (compiled out of production,
 * SPEC 17.3) that logs the recognizer's output but does not act on it, and the
 * transcript is supplied through the `test.transcript` hook exactly as a correct
 * recognizer would have delivered it. QA_REAL_STT=1 lets the real recognizer through.
 */

import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  chromium,
  type BrowserContext,
  type Page,
  type Route,
  type Worker,
} from "@playwright/test";
import { AUDIO_DIR, SAMPLE_RATE } from "../../../scripts/generate-test-audio";
import { type DemoServerHandle, startDemoServer } from "../demo-server";

export const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
export const DEV_DIST = resolve(REPO_ROOT, "dist-test");
const PROFILE_ROOT = resolve(REPO_ROOT, ".playwright-user-data", "qa");

export const GEMINI_URL_GLOB = "https://generativelanguage.googleapis.com/**";
export const ELEVENLABS_URL_GLOB = "https://api.elevenlabs.io/**";

/** What a working recognizer would emit for each fixture (normalization-ready). */
export const SPOKEN_TEXT: Record<string, string> = {
  "golden-path.wav": "Book the 9:40 flight.",
  "ambiguity-trap.wav": "Click the Download button.",
  "silence.wav": "",
  "sequence.wav": "Fill in John Doe, then click submit, and then click confirm.",
  "clarify-second.wav": "The second one.",
  "click-search.wav": "Click search flights.",
  "fill-from.wav": "Type Toronto into From.",
};

export const DEFAULT_SETTINGS = {
  geminiApiKey: null as string | null,
  geminiModel: "gemini-3.1-flash-lite",
  verbosity: "fast" as "fast" | "verbose",
  ttsVoiceName: null as string | null,
  ttsRate: 1.6,
  holdKey: "Space",
  scanKey: "KeyM",
  telemetryEnabled: false,
  audioEnabled: true,
  useLocalTts: true,
  elevenLabsApiKey: null as string | null,
};
export type QaSettings = typeof DEFAULT_SETTINGS;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Builds a development bundle (with the SPEC 17.3 hook) into dist-test/. */
export function buildDevExtension(): void {
  execSync("pnpm run build", {
    cwd: REPO_ROOT,
    env: { ...process.env, ECHO_BUILD_MODE: "development", ECHO_OUT_DIR: "dist-test" },
    stdio: "pipe",
  });
}

/** Duration of a generated fixture in seconds, from its PCM byte length. */
export function wavSeconds(file: string): number {
  return (statSync(resolve(AUDIO_DIR, file)).size - 44) / (SAMPLE_RATE * 2);
}

export interface MicEvidence {
  /** Largest absolute sample seen on the microphone during the take (0..1). */
  peak: number;
  /** Milliseconds during which the level exceeded 0.02. */
  activeMs: number;
}

export interface SessionEvent {
  state: string;
  at: number;
}

export interface SpeakEvent {
  text: string;
  at: number;
  enqueue?: boolean;
}

export interface FetchRecord {
  url: string;
  issuedAt: number;
  respondedAt: number;
  status: number;
  error?: string;
}

export interface ContentMessageRecord {
  type: string;
  sentAt: number;
  /** When the content script's answer (or a rejection) came back; null while pending. */
  doneAt: number | null;
}

export interface GeminiCall {
  at: number;
  body: GeminiRequestBody;
}

export interface GeminiRequestBody {
  contents: Array<{ parts: Array<{ text: string }> }>;
  [key: string]: unknown;
}

export interface PromptElementLite {
  id: string;
  role: string;
  name: string;
  region: string;
}

export interface LaunchOptions {
  /** Fixture placed on the fake microphone at launch (swap later with setAudio). */
  audio: string;
  settings?: Partial<QaSettings>;
  /**
   * Drop the real recognizer's results and errors (logged, not acted on) so the
   * injected transcript is the only one. Default true. Forced off by QA_REAL_STT=1.
   */
  ignoreRealStt?: boolean;
}

export class Qa {
  readonly swLogs: string[] = [];
  readonly pageLogs: string[] = [];
  readonly geminiCalls: GeminiCall[] = [];
  readonly elevenLabsCalls: number[] = [];

  constructor(
    readonly ctx: BrowserContext,
    readonly page: Page,
    readonly helper: Page,
    readonly sw: Worker,
    readonly server: DemoServerHandle,
    private readonly livePath: string
  ) {}

  // -- microphone ----------------------------------------------------------

  /** Chrome re-reads the WAV every time a capture stream opens (probed), so this swaps the next take. */
  setAudio(file: string): void {
    copyFileSync(resolve(AUDIO_DIR, file), this.livePath);
  }

  // -- service worker observation ------------------------------------------

  async sessionState(): Promise<string> {
    return this.sw.evaluate(async () => {
      const r = await chrome.storage.session.get("session");
      return (r.session as { state?: string } | undefined)?.state ?? "IDLE";
    });
  }

  async session(): Promise<Record<string, unknown>> {
    return this.sw.evaluate(async () => {
      const r = await chrome.storage.session.get("session");
      return (r.session ?? {}) as Record<string, unknown>;
    });
  }

  /** Persisted state transitions since launch (recorded via storage.onChanged). */
  async transitions(): Promise<SessionEvent[]> {
    return this.sw.evaluate(() => (globalThis as unknown as { __qa: { states: SessionEvent[] } }).__qa.states);
  }

  async spoken(): Promise<SpeakEvent[]> {
    return this.sw.evaluate(() => (globalThis as unknown as { __qa: { speak: SpeakEvent[] } }).__qa.speak);
  }

  async stopCalls(): Promise<number[]> {
    return this.sw.evaluate(() => (globalThis as unknown as { __qa: { stop: number[] } }).__qa.stop);
  }

  /** Every fetch the service worker issued (Gemini, ElevenLabs), timed inside the SW. */
  async fetchLog(): Promise<FetchRecord[]> {
    return this.sw.evaluate(() => (globalThis as unknown as { __qa: { fetches: FetchRecord[] } }).__qa.fetches);
  }

  /** tts.play / tts.stop messages the SW sent to the content script. */
  async ttsMessages(): Promise<ContentMessageRecord[]> {
    return this.sw.evaluate(
      () => (globalThis as unknown as { __qa: { messages: ContentMessageRecord[] } }).__qa.messages
    );
  }

  /** Switch the dev-build "ignore the real recognizer" flag (see LaunchOptions.ignoreRealStt). */
  async ignoreRealStt(on: boolean): Promise<void> {
    await this.sw.evaluate(async (v) => {
      await chrome.storage.session.set({ "qa.ignoreStt": v });
    }, on && process.env.QA_REAL_STT !== "1");
  }

  /** What the real recognizer actually heard (informational: it is unreliable on synthetic speech). */
  realTranscripts(): string[] {
    return this.swLogs
      .filter((l) => l.includes("real recognizer heard:"))
      .map((l) => l.replace("[ECHO SW] real recognizer heard: ", ""));
  }

  async isSpeaking(): Promise<boolean> {
    return this.sw.evaluate(() => chrome.tts.isSpeaking());
  }

  async tabAudible(): Promise<boolean> {
    return this.sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: "http://127.0.0.1/*" });
      return tabs.some((t) => t.audible === true);
    });
  }

  /** Number of recognizer lifecycle events of a kind that reached the SW. */
  sttEvents(name: "audiostart" | "speechstart" | "speechend"): number {
    return this.swLogs.filter((l) => l.includes(`stt.event ${name}`)).length;
  }

  async waitForState(states: string | string[], timeoutMs = 8000): Promise<string> {
    const want = Array.isArray(states) ? states : [states];
    const start = Date.now();
    for (;;) {
      const current = await this.sessionState();
      if (want.includes(current)) return current;
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `timed out waiting for state ${want.join("|")}; state=${current}; transitions=${JSON.stringify(
            (await this.transitions()).map((t) => t.state)
          )}`
        );
      }
      await sleep(25);
    }
  }

  /** Waits until a state has been *seen* since `fromIndex` transitions (catches short-lived states). */
  async waitForSeen(state: string, fromIndex = 0, timeoutMs = 8000): Promise<void> {
    const start = Date.now();
    for (;;) {
      const seen = (await this.transitions()).slice(fromIndex).some((t) => t.state === state);
      if (seen) return;
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `timed out waiting to see ${state}; transitions=${JSON.stringify((await this.transitions()).map((t) => t.state))}`
        );
      }
      await sleep(25);
    }
  }

  /** Waits until the pipeline has finished the current command and the SW is idle again. */
  async waitForIdleAfter(fromIndex: number, timeoutMs = 12_000): Promise<void> {
    const start = Date.now();
    for (;;) {
      const t = (await this.transitions()).slice(fromIndex);
      const last = t[t.length - 1];
      if (t.length > 0 && last.state === "IDLE" && (await this.sessionState()) === "IDLE") return;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`timed out waiting for IDLE; transitions=${JSON.stringify(t.map((x) => x.state))}`);
      }
      await sleep(25);
    }
  }

  // -- hold to talk ---------------------------------------------------------

  /**
   * Independent proof of what the fake microphone carried during the last take:
   * a second capture stream opened in the page while the key is held, sampled
   * for the length of the audio. (Chrome's speech endpointer is not usable as
   * evidence: it fires `speechstart` on digital silence too.)
   */
  lastMicEvidence: MicEvidence | null = null;

  /**
   * Presses Space, waits for the recognizer to actually open the (fake)
   * microphone, keeps the key down for the duration of the audio, releases.
   * Returns the index into `transitions()` where this take started.
   */
  async holdAndSpeak(file: string, opts: { extraHoldMs?: number } = {}): Promise<number> {
    const mark = (await this.transitions()).length;
    const audioStarts = this.sttEvents("audiostart");
    await this.page.bringToFront();
    await this.page.keyboard.down("Space");
    const start = Date.now();
    while (this.sttEvents("audiostart") === audioStarts) {
      if (Date.now() - start > 8000) throw new Error("recognizer never opened the microphone (no audiostart)");
      await sleep(20);
    }
    const holdMs = wavSeconds(file) * 1000 + (opts.extraHoldMs ?? 0);
    const evidence = this.page.evaluate(async (ms) => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let peak = 0;
      let activeMs = 0;
      const t0 = performance.now();
      let last = t0;
      while (performance.now() - t0 < ms) {
        analyser.getFloatTimeDomainData(buf);
        let p = 0;
        for (const v of buf) p = Math.max(p, Math.abs(v));
        peak = Math.max(peak, p);
        const now = performance.now();
        if (p > 0.02) activeMs += now - last;
        last = now;
        await new Promise((r) => setTimeout(r, 20));
      }
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
      return { peak, activeMs: Math.round(activeMs) };
    }, holdMs);
    await sleep(holdMs);
    await this.page.keyboard.up("Space");
    this.lastMicEvidence = await evidence;
    return mark;
  }

  /**
   * Delivers the transcript for a take. With QA_REAL_STT=1 a real recognizer
   * result is given a chance first. Otherwise (and as the fallback) the SPEC
   * 17.3 hook injects it. Returns which path supplied the transcript.
   */
  async deliverTranscript(file: string, override?: string): Promise<"stt" | "injected"> {
    if (process.env.QA_REAL_STT === "1") {
      const start = Date.now();
      while (Date.now() - start < 4000) {
        const s = await this.sessionState();
        if (["RESOLVING", "MODEL_RESOLVING", "EXECUTING", "CLARIFYING", "CONFIRMING"].includes(s)) return "stt";
        await sleep(50);
      }
    }
    const transcript = override ?? SPOKEN_TEXT[file];
    await this.helper.evaluate(async (t) => {
      await chrome.runtime.sendMessage({
        ns: "echo",
        target: "sw",
        type: "test.transcript",
        reqId: crypto.randomUUID(),
        payload: { transcript: t },
      });
    }, transcript);
    return "injected";
  }

  /** Full take: hold Space for the audio, release, deliver transcript. */
  async speak(file: string, opts: { transcript?: string; extraHoldMs?: number } = {}) {
    this.setAudio(file);
    const mark = await this.holdAndSpeak(file, opts);
    const source = await this.deliverTranscript(file, opts.transcript);
    return { mark, source };
  }

  // -- page probes ----------------------------------------------------------

  /** Records highlight class add/remove and bubbling input/change events on the demo page. */
  async installPageProbes(): Promise<void> {
    await this.page.evaluate(() => {
      type W = Window & { __probe?: unknown };
      const w = window as W;
      if (w.__probe) return;
      const probe = {
        highlights: [] as Array<{ id: string; on: number; off: number | null }>,
        bubbled: [] as Array<{ type: string; id: string }>,
        reactChanges: [] as string[],
        clicks: [] as string[],
      };
      w.__probe = probe;
      new MutationObserver((records) => {
        for (const r of records) {
          const el = r.target as Element;
          if (r.type !== "attributes" || r.attributeName !== "class") continue;
          const id = el.id || el.tagName;
          const has = el.classList.contains("echo-highlight");
          const open = probe.highlights.find((h) => h.id === id && h.off === null);
          if (has && !open) probe.highlights.push({ id, on: performance.now(), off: null });
          if (!has && open) open.off = performance.now();
        }
      }).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["class"] });
      for (const type of ["input", "change"]) {
        // Bubbling phase on document: only sees the event when bubbles === true.
        document.addEventListener(type, (e) => probe.bubbled.push({ type, id: (e.target as Element).id }), false);
      }
      document.addEventListener("click", (e) => probe.clicks.push((e.target as Element).id), true);
    });
  }

  /**
   * Emulates React's controlled-input value tracker on an element: assigning
   * through the *instance* `value` setter updates the tracked value, so a later
   * `input` event looks like "no change" and the framework drops it. Only a
   * write through the native prototype setter is noticed.
   */
  async attachReactTracker(selector: string): Promise<void> {
    await this.page.evaluate((sel) => {
      const input = document.querySelector<HTMLInputElement>(sel)!;
      const w = window as unknown as { __probe: { reactChanges: string[] } };
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
      let tracked = String(desc.get!.call(input));
      Object.defineProperty(input, "value", {
        configurable: true,
        get() {
          return desc.get!.call(this);
        },
        set(v: string) {
          tracked = String(v);
          desc.set!.call(this, v);
        },
      });
      input.addEventListener("input", () => {
        const now = String(desc.get!.call(input));
        if (now !== tracked) {
          tracked = now;
          w.__probe.reactChanges.push(now);
        }
      });
    }, selector);
  }

  async probe<T = unknown>(): Promise<{
    highlights: Array<{ id: string; on: number; off: number | null }>;
    bubbled: Array<{ type: string; id: string }>;
    reactChanges: string[];
    clicks: string[];
  } & T> {
    return this.page.evaluate(() => (window as unknown as { __probe: never }).__probe);
  }

  // -- Gemini ---------------------------------------------------------------

  /** Routes Gemini calls; the handler decides the response. Records every call. */
  async routeGemini(
    handler: (route: Route, call: GeminiCall, n: number) => Promise<void>
  ): Promise<void> {
    await this.ctx.route(GEMINI_URL_GLOB, async (route) => {
      const call: GeminiCall = {
        at: Date.now(),
        body: JSON.parse(route.request().postData() ?? "{}") as GeminiRequestBody,
      };
      this.geminiCalls.push(call);
      await handler(route, call, this.geminiCalls.length);
    });
  }

  async close(): Promise<void> {
    await this.ctx.close().catch(() => {});
    await this.server.close().catch(() => {});
  }
}

/** Elements the model would have seen, parsed back out of a recorded request. */
export function promptElements(call: GeminiCall): PromptElementLite[] {
  const text = call.body.contents[0].parts[1].text;
  const json = text.replace(/^<page_elements>/, "").replace(/<\/page_elements>$/, "");
  return JSON.parse(json) as PromptElementLite[];
}

/** A mono 16-bit PCM WAV of a sine tone, used as the stubbed ElevenLabs response. */
export function toneWav(seconds: number, hz = 440, rate = 22_050): Buffer {
  const frames = Math.round(seconds * rate);
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 0.3 * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export function idOf(elements: PromptElementLite[], name: RegExp): string {
  const found = elements.find((e) => name.test(e.name));
  if (!found) throw new Error(`no prompt element matching ${name}: ${elements.map((e) => e.name).join(" | ")}`);
  return found.id;
}

/** A well-formed Gemini generateContent envelope around a ResolverResponse. */
export function geminiEnvelope(resolverResponse: unknown): string {
  return JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(resolverResponse) }] } }],
  });
}

export async function fulfillGemini(route: Route, resolverResponse: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: geminiEnvelope(resolverResponse),
  });
}

export async function launchQa(opts: LaunchOptions): Promise<Qa> {
  mkdirSync(PROFILE_ROOT, { recursive: true });
  const profile = mkdtempSync(resolve(PROFILE_ROOT, "p-"));
  const livePath = resolve(profile, "mic.wav");
  copyFileSync(resolve(AUDIO_DIR, opts.audio), livePath);

  const server = await startDemoServer(0);
  const ctx = await chromium.launchPersistentContext(resolve(profile, "data"), {
    headless: false,
    args: [
      `--disable-extensions-except=${DEV_DIST}`,
      `--load-extension=${DEV_DIST}`,
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      // %noloop: play the file once per capture instead of looping it forever.
      `--use-file-for-fake-audio-capture=${livePath}%noloop`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(sw.url()).host;
  const settings = { ...DEFAULT_SETTINGS, ...(opts.settings ?? {}) };

  // Seed storage as a returning user (mic already granted; F-02 has its own tests)
  // and install the SW-side observers.
  await sw.evaluate(async ({ s, ignore }) => {
    await chrome.storage.local.set({ micGranted: true, settings: s });
    await chrome.storage.session.set({ "qa.ignoreStt": ignore });
    const g = globalThis as unknown as {
      __qa?: unknown;
    };
    if (g.__qa) return;
    const qa = {
      speak: [] as unknown[],
      stop: [] as number[],
      states: [] as unknown[],
      fetches: [] as unknown[],
      messages: [] as Array<{ type: string; sentAt: number; doneAt: number | null }>,
    };
    g.__qa = qa;

    // Time every fetch from inside the SW (retry delays are measured here, not
    // through Playwright's round trip).
    const realFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const issuedAt = Date.now();
      try {
        const res = await realFetch(input, init);
        qa.fetches.push({ url, issuedAt, respondedAt: Date.now(), status: res.status });
        return res;
      } catch (err) {
        qa.fetches.push({ url, issuedAt, respondedAt: Date.now(), status: 0, error: String(err) });
        throw err;
      }
    };

    // Record tts.play / tts.stop traffic to the content script.
    const realSend = chrome.tabs.sendMessage.bind(chrome.tabs) as (...a: unknown[]) => Promise<unknown>;
    (chrome.tabs as unknown as { sendMessage: unknown }).sendMessage = (...args: unknown[]) => {
      const type = (args[1] as { type?: string } | undefined)?.type ?? "";
      const promise = realSend(...args);
      if (type === "tts.play" || type === "tts.stop") {
        const rec = { type, sentAt: Date.now(), doneAt: null as number | null };
        qa.messages.push(rec);
        const finish = () => {
          rec.doneAt = Date.now();
        };
        promise.then(finish, finish);
      }
      return promise;
    };
    const speak = chrome.tts.speak.bind(chrome.tts);
    (chrome.tts as unknown as { speak: unknown }).speak = (
      text: string,
      options: chrome.tts.TtsOptions,
      cb?: () => void
    ) => {
      qa.speak.push({ text, at: Date.now(), enqueue: options?.enqueue });
      return speak(text, options, cb ?? (() => {}));
    };
    const stop = chrome.tts.stop.bind(chrome.tts);
    (chrome.tts as unknown as { stop: unknown }).stop = () => {
      qa.stop.push(Date.now());
      return stop();
    };
    chrome.storage.session.onChanged.addListener((changes) => {
      const next = (changes.session?.newValue as { state?: string } | undefined)?.state;
      const prev = (changes.session?.oldValue as { state?: string } | undefined)?.state;
      if (next && next !== prev) qa.states.push({ state: next, at: Date.now() });
    });
  }, { s: settings, ignore: (opts.ignoreRealStt ?? true) && process.env.QA_REAL_STT !== "1" });

  const page = await ctx.newPage();
  const ready = new Promise<void>((res) =>
    page.on("console", (m) => {
      if (m.text().includes("[ECHO] content script ready")) res();
    })
  );
  await page.goto(server.url);
  await Promise.race([
    ready,
    sleep(8000).then(() => {
      throw new Error("content script never announced readiness");
    }),
  ]);

  // An extension page in a background tab gives the harness a legitimate
  // chrome.runtime.sendMessage origin for the SPEC 17.3 test.transcript hook.
  const helper = await ctx.newPage();
  await helper.goto(`chrome-extension://${extensionId}/src/pages/options.html`);
  await page.bringToFront();

  const qa = new Qa(ctx, page, helper, sw, server, livePath);
  page.on("console", (m) => qa.pageLogs.push(`${Date.now() % 100000} ${m.text()}`));
  sw.on("console", (m) => qa.swLogs.push(m.text()));
  return qa;
}
