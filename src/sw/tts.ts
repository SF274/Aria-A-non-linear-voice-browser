/**
 * TTS service — SPEC §10.6 + HD-A06/HD-07 (dual-engine architecture).
 *
 * Dual-engine routing (HD-A06, HD-07):
 *   - settings.useLocalTts === true  → chrome.tts (on-device, SPEC §10.6.1)
 *   - settings.useLocalTts === false → ElevenLabs Flash/Turbo via fetch
 *     (~75ms latency), ArrayBuffer passed to content script for AudioContext
 *     playback (MV3 service workers have no AudioContext).
 *
 * Confirmation formatter implements the exact table from SPEC §10.6.3:
 *   {name} truncated to 40 chars per §10.6.3.
 *
 * Interruption (§10.6.4 & §4.5):
 *   stopTts() → chrome.tts.stop() + AbortController.abort() + tts.stop to CS.
 */

import type { ExecuteResult, Verbosity } from "../shared/contracts";
import {
  ACTIVE_TAB_KEY,
  CONFIRMATION_NAME_MAX_CHARS,
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_VOICE_ID,
  DEFAULT_TTS_RATE,
  ELEVENLABS_VOICE_SETTINGS,
  TTS_CHUNK_MAX_CHARS,
} from "../shared/constants";
import { panForX } from "../shared/spatial";

// ---------------------------------------------------------------------------
// Module-level state for interruption
// ---------------------------------------------------------------------------

/** Active AbortController for an in-flight ElevenLabs fetch. */
let _activeAbortController: AbortController | null = null;

/** ID of the active tab being used for ElevenLabs audio playback routing. */
let _activePlaybackTabId: number | null = null;

// ---------------------------------------------------------------------------
// SPEC §10.6.2 — Voice selection
// ---------------------------------------------------------------------------

/**
 * Select a TTS voice per SPEC §10.6.2 priority:
 *   1. Non-Google English voice
 *   2. Any English voice
 *   3. First available voice
 *   4. null (system default)
 */
export function selectTtsVoice(voices: chrome.tts.TtsVoice[]): string | null {
  if (!voices || voices.length === 0) return null;

  // Priority 1: non-Google English voice
  const nonGoogleEn = voices.find(
    (v) =>
      v.lang?.startsWith("en") &&
      typeof v.voiceName === "string" &&
      !v.voiceName.includes("Google")
  );
  if (nonGoogleEn?.voiceName) return nonGoogleEn.voiceName;

  // Priority 2: any English voice
  const anyEn = voices.find((v) => v.lang?.startsWith("en"));
  if (anyEn?.voiceName) return anyEn.voiceName;

  // Priority 3: first available
  const first = voices[0];
  if (first?.voiceName) return first.voiceName;

  return null;
}

// ---------------------------------------------------------------------------
// SPEC §10.6.2 — Sentence chunking
// ---------------------------------------------------------------------------

/**
 * Split text into sentences for chunked TTS playback.
 * Utterances > 200 characters are split at sentence boundaries, then queued
 * with enqueue: true to avoid the 15s Chrome TTS cutoff bug (§10.6.2).
 */
export function chunkTextIntoSentences(text: string): string[] {
  if (text.length <= TTS_CHUNK_MAX_CHARS) return [text];
  const raw = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  const chunks: string[] = [];
  for (const sentence of raw) {
    const trimmed = sentence.trim();
    if (trimmed) chunks.push(trimmed);
  }
  return chunks.length > 0 ? chunks : [text];
}

// ---------------------------------------------------------------------------
// SPEC §10.6.3 — Confirmation formatter
// ---------------------------------------------------------------------------

/** Truncate a name to 40 chars per §10.6.3. */
function truncateName(name: string | null | undefined): string {
  const s = name ?? "";
  return s.length > CONFIRMATION_NAME_MAX_CHARS
    ? s.slice(0, CONFIRMATION_NAME_MAX_CHARS)
    : s;
}

/** Past tense verb forms for verbose sequence template. */
const VERB_PAST: Record<string, string> = {
  click: "clicked",
  fill: "filled",
  select: "selected",
  check: "checked",
  uncheck: "unchecked",
  scrollTo: "scrolled to",
  focus: "focused on",
};

function verbPast(verb: string): string {
  return VERB_PAST[verb] ?? verb;
}

// Template parameter types for confirmation string generation
export type ConfirmationSituation =
  | { kind: "click"; name: string }
  | { kind: "fill"; name: string; value: string }
  | { kind: "sequence"; n: number; steps: Array<{ verb: string; name: string }> }
  | { kind: "partial_failure"; nameOfLastOk: string | null; name: string }
  | { kind: "not_found"; transcript: string }
  | { kind: "low_confidence" };

/**
 * Format a spoken confirmation string from an ExecuteResult.
 * Implements SPEC §10.6.3 table exactly for both verbosity levels.
 */
export function formatConfirmation(
  situation: ConfirmationSituation,
  verbosity: Verbosity
): string {
  const fast = verbosity === "fast";

  switch (situation.kind) {
    case "click": {
      const n = truncateName(situation.name);
      return fast ? `${n}.` : `Clicked ${n}.`;
    }

    case "fill": {
      const n = truncateName(situation.name);
      const v = situation.value;
      return fast ? `${v} in ${n}.` : `Entered ${v} in ${n}.`;
    }

    case "sequence": {
      if (fast) {
        return `Done. ${situation.n} steps.`;
      }
      // verbose: name up to 3 steps
      const named = situation.steps.slice(0, 3);
      if (named.length === 0) return `Done. ${situation.n} steps.`;
      const parts = named.map((s) => `${verbPast(s.verb)} ${truncateName(s.name)}`);
      if (parts.length === 1) return `Done. I ${parts[0]}.`;
      const last = parts.pop()!;
      return `Done. I ${parts.join(", then ")}, then ${last}.`;
    }

    case "partial_failure": {
      const n = truncateName(situation.name);
      if (fast) return `Stopped at ${n}.`;
      const lastOk = truncateName(situation.nameOfLastOk);
      if (!lastOk) return `Couldn't find ${n}.`;
      return `I got as far as ${lastOk}, then couldn't find ${n}.`;
    }

    case "not_found": {
      if (fast) return `I can't find that.`;
      const t = truncateName(situation.transcript);
      return `I couldn't find anything called ${t} on this page.`;
    }

    case "low_confidence": {
      return fast ? "Not sure which one." : "I'm not sure which one you mean.";
    }
  }
}

/**
 * Build a ConfirmationSituation from an ExecuteResult and an optional
 * transcript (for the not_found case).
 */
export function situationFromResult(
  result: ExecuteResult,
  transcript?: string
): ConfirmationSituation {
  if (!result.ok && result.results.length === 0) {
    return { kind: "not_found", transcript: transcript ?? "" };
  }

  if (result.results.length === 1 && result.ok) {
    const step = result.results[0];
    if (step.verb === "fill") {
      return {
        kind: "fill",
        name: step.resolvedName ?? step.elementId,
        value: "", // value is available upstream from action
      };
    }
    return { kind: "click", name: step.resolvedName ?? step.elementId };
  }

  if (result.results.length > 1 && result.ok) {
    return {
      kind: "sequence",
      n: result.completed,
      steps: result.results.map((s) => ({
        verb: s.verb,
        name: s.resolvedName ?? s.elementId,
      })),
    };
  }

  // Partial failure
  if (!result.ok && result.results.length > 0) {
    const failedIdx = result.failedAtIndex ?? result.results.length - 1;
    const failedStep = result.results[failedIdx];
    const lastOkStep = failedIdx > 0 ? result.results[failedIdx - 1] : null;
    return {
      kind: "partial_failure",
      nameOfLastOk: lastOkStep?.resolvedName ?? null,
      name: failedStep?.resolvedName ?? failedStep?.elementId ?? "",
    };
  }

  // not_found
  return { kind: "not_found", transcript: transcript ?? "" };
}

// ---------------------------------------------------------------------------
// SPEC §10.6.2 — chrome.tts local playback
// ---------------------------------------------------------------------------

function speakLocal(
  text: string,
  rate: number,
  voiceName: string | null,
  onDone?: () => void
): void {
  const chunks = chunkTextIntoSentences(text);
  type TtsSpeakOptions = NonNullable<Parameters<typeof chrome.tts.speak>[1]>;
  const options: TtsSpeakOptions = {
    rate,
    ...(voiceName ? { voiceName } : {}),
  };

  // Completion is reported once: when the last chunk ends, or as soon as any
  // chunk errors or is interrupted (chrome.tts.stop() drops the whole queue).
  let finished = false;
  const done = (): void => {
    if (finished) return;
    finished = true;
    onDone?.();
  };

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    chrome.tts.speak(chunks[i], {
      ...options,
      enqueue: i > 0,
      ...(onDone
        ? {
            onEvent: (event: chrome.tts.TtsEvent) => {
              if (
                event.type === "error" ||
                event.type === "interrupted" ||
                event.type === "cancelled" ||
                (isLast && event.type === "end")
              ) {
                done();
              }
            },
          }
        : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// HD-A06 — ElevenLabs cloud TTS (Flash/Turbo, ~75ms latency)
// ---------------------------------------------------------------------------

/**
 * Fetch audio from ElevenLabs and route the ArrayBuffer to the content script
 * of the given tab for playback via its AudioContext.
 *
 * MV3 Service Workers have no AudioContext (SPEC design note), so the buffer
 * is sent via chrome.tabs.sendMessage to the content script which owns it.
 */
async function speakElevenLabs(
  text: string,
  apiKey: string,
  voiceId: string,
  tabId: number,
  pan = 0
): Promise<void> {
  const controller = new AbortController();
  _activeAbortController = controller;
  _activePlaybackTabId = tabId;

  try {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: DEFAULT_ELEVENLABS_MODEL_ID,
        output_format: "mp3_44100_128",
        // Without this the API applies the voice's stored defaults, which open
        // loud and over-emphatic before settling. See ELEVENLABS_VOICE_SETTINGS.
        voice_settings: ELEVENLABS_VOICE_SETTINGS,
      }),
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs API returned HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    // stopTts() may have fired after the headers arrived but before the body did.
    if (controller.signal.aborted) return;
    _activeAbortController = null;

    // Send to content script for AudioContext playback
    // The base64 encode is used because ArrayBuffers are not serializable
    // across chrome.tabs.sendMessage without explicit transfer.
    const base64 = arrayBufferToBase64(arrayBuffer);
    await chrome.tabs.sendMessage(tabId, {
      ns: "echo",
      target: "content",
      type: "tts.play",
      reqId: crypto.randomUUID(),
      payload: { audioBase64: base64, mimeType: "audio/mpeg", pan },
    });
  } catch (err) {
    _activeAbortController = null;
    const isAbort =
      err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"));
    if (!isAbort) {
      console.warn("[ECHO TTS] ElevenLabs fetch failed:", err);
    }
    // Re-throw only non-abort errors so caller can fallback
    if (!isAbort) throw err;
  }
}

async function getPlaybackTabId(): Promise<number | null> {
  try {
    const stored = await chrome.storage.session.get(ACTIVE_TAB_KEY);
    const remembered = stored?.[ACTIVE_TAB_KEY];
    if (typeof remembered === "number") return remembered;
  } catch {
    // storage.session unavailable; fall through to the tab query.
  }
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return typeof activeTab?.id === "number" ? activeTab.id : null;
}

/** Convert ArrayBuffer to Base64 string for message serialization. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SpeakOptions {
  text: string;
  /** Called once when speech has finished, been interrupted, or failed. */
  onDone?: () => void;
  useLocalTts: boolean;
  elevenLabsApiKey: string | null;
  elevenLabsVoiceId?: string;
  ttsVoiceName: string | null;
  ttsRate: number;
  /**
   * HD-12 ("spatial links"): where on the page the thing being spoken about is,
   * as a stereo pan in [-1, 1] under SPEC 9.3's `pan(x)`. Omitted or 0 means
   * centre, which is every utterance that is not about one element.
   *
   * SPEC 9.1 records as `[FACT]` that speech cannot be panned, and for
   * `chrome.tts` that is still true — nothing can route its output into a Web
   * Audio graph. HD-07's ElevenLabs path is different in kind: it returns an
   * MP3 the content script decodes itself, so it is already in a graph and a
   * `StereoPannerNode` is all it takes. This is therefore honoured on the
   * ElevenLabs path and ignored on the local one.
   */
  pan?: number;
}

/**
 * Speak text using the dual-engine architecture (HD-A06).
 * Routes to chrome.tts or ElevenLabs based on settings.useLocalTts.
 * Falls back to chrome.tts if ElevenLabs key is missing or request fails.
 */
export async function speakText(opts: SpeakOptions): Promise<void> {
  const {
    text,
    useLocalTts,
    elevenLabsApiKey,
    elevenLabsVoiceId = DEFAULT_ELEVENLABS_VOICE_ID,
    ttsVoiceName,
    ttsRate,
    onDone,
    pan = 0,
  } = opts;

  if (useLocalTts || !elevenLabsApiKey) {
    // Local path: chrome.tts with sentence chunking. Say which of the two
    // reasons applied: "the voice sounds wrong" is usually one of these two
    // silently choosing chrome.tts, and they need opposite fixes.
    console.info(
      `[ECHO TTS] engine=chrome.tts reason=${
        useLocalTts ? "useLocalTts is true" : "no ElevenLabs API key"
      } rate=${ttsRate}`
    );
    speakLocal(text, ttsRate, ttsVoiceName, onDone);
    return;
  }

  // Cloud path: ElevenLabs Flash/Turbo
  try {
    // Route playback to the tab where the user pressed the key; otherwise the active tab.
    const tabId = await getPlaybackTabId();

    if (tabId === null) {
      console.warn("[ECHO TTS] No active tab for ElevenLabs playback; falling back to chrome.tts");
      speakLocal(text, ttsRate, ttsVoiceName, onDone);
      return;
    }

    console.info(`[ECHO TTS] engine=elevenlabs voice=${elevenLabsVoiceId} tab=${tabId}`);
    // Resolves when playback has finished (the content script answers tts.play on end)
    // or the request was aborted by stopTts().
    await speakElevenLabs(text, elevenLabsApiKey, elevenLabsVoiceId, tabId, pan);
    onDone?.();
  } catch (err) {
    // ElevenLabs failed: fall back to chrome.tts. This await spans the whole
    // clip, so a rejection here can land mid-playback and start chrome.tts on
    // top of audio that is still going. Log the cause; a silent swap between
    // engines is what makes this sound like one voice changing character.
    console.warn("[ECHO TTS] engine=chrome.tts reason=ElevenLabs failed:", err);
    speakLocal(text, ttsRate, ttsVoiceName, onDone);
  }
}

/**
 * Stop all active TTS — both chrome.tts and any in-flight ElevenLabs request.
 * Called on every key.down per SPEC §10.6.4 & §4.5.
 */
export function stopTts(): void {
  // Stop local TTS
  chrome.tts.stop();

  // Abort any in-flight ElevenLabs fetch
  if (_activeAbortController) {
    _activeAbortController.abort();
    _activeAbortController = null;
  }

  // Tell the content script to stop any currently playing audio
  if (_activePlaybackTabId !== null) {
    const tabId = _activePlaybackTabId;
    _activePlaybackTabId = null;
    chrome.tabs
      .sendMessage(tabId, {
        ns: "echo",
        target: "content",
        type: "tts.stop",
        reqId: crypto.randomUUID(),
        payload: {},
      })
      .catch(() => {
        // Content script may not be alive; safe to ignore
      });
  }
}

/**
 * Load settings and speak text. Convenience wrapper for the service worker.
 * Reads settings from chrome.storage.local.
 */
export async function speakFromSettings(
  text: string,
  onDone?: () => void,
  /**
   * HD-12: document-relative x of what this sentence is about, 0..1. Turned
   * into a pan here rather than by the caller, because this is also where
   * `settings.spatialLinks` lives — one place decides, and every caller can
   * simply say where the thing is.
   */
  atX?: number
): Promise<void> {
  try {
    const data = await chrome.storage.local.get("settings");
    const settings = data?.settings as {
      useLocalTts?: boolean;
      elevenLabsApiKey?: string | null;
      elevenLabsVoiceId?: string;
      ttsVoiceName?: string | null;
      ttsRate?: number;
      spatialLinks?: boolean;
    } | undefined;

    // Default on, like the options page's default. Off, or no position, is centre.
    const spatial = settings?.spatialLinks !== false;
    const pan = spatial && typeof atX === "number" ? panForX(atX) : 0;

    await speakText({
      text,
      useLocalTts: settings?.useLocalTts ?? true,
      elevenLabsApiKey: settings?.elevenLabsApiKey ?? null,
      elevenLabsVoiceId: settings?.elevenLabsVoiceId ?? DEFAULT_ELEVENLABS_VOICE_ID,
      ttsVoiceName: settings?.ttsVoiceName ?? null,
      ttsRate: settings?.ttsRate ?? DEFAULT_TTS_RATE,
      onDone,
      pan,
    });
  } catch (err) {
    // Last-resort chrome.tts if anything above throws. This path used to be
    // silent, which made it indistinguishable from the configured engine while
    // sounding nothing like it: no voice selection, no chunking, and a hard
    // coded rate that ignores ttsRate entirely.
    console.warn("[ECHO TTS] engine=chrome.tts reason=settings/speak threw:", err);
    chrome.tts.speak(text, { rate: DEFAULT_TTS_RATE });
    onDone?.();
  }
}
