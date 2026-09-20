/**
 * Exhaustive true-audio QA suite.
 *
 * Every take goes: generated WAV -> Chromium fake microphone -> real Space
 * keydown/keyup through the content script -> service worker -> offscreen
 * document `SpeechRecognition` session (which really opens the stream; the
 * suite asserts `audiostart` / `speechstart`) -> transcript -> local resolver /
 * Gemini -> executor -> TTS.
 *
 * See test/e2e/support/qa-harness.ts for the honest caveat: Chromium's speech
 * service is network-dependent and, for a synthetic voice, unreliable (it heard
 * "play welcome home" for "Book the 9:40 flight"), so the dev build ignores its
 * results and the transcript comes from the SPEC 17.3 `test.transcript` hook.
 * QA_REAL_STT=1 lets the real recognizer through instead.
 */

import { expect, test } from "@playwright/test";
import {
  buildDevExtension,
  ELEVENLABS_URL_GLOB,
  fulfillGemini,
  type GeminiCall,
  idOf,
  launchQa,
  promptElements,
  type Qa,
  sleep,
  toneWav,
  wavSeconds,
} from "./support/qa-harness";

test.describe.configure({ timeout: 90_000 });

test.beforeAll(() => {
  buildDevExtension();
});

let qa: Qa | null = null;
// Playwright insists the first argument is a destructuring pattern, even when empty.
// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => {
  if (qa && testInfo.status !== testInfo.expectedStatus) {
    // Everything needed to diagnose a failure without re-running it.
    const transitions = await qa.transitions().catch(() => []);
    const spoken = await qa.spoken().catch(() => []);
    await testInfo.attach("sw-diagnostics.txt", {
      body: [
        `transitions: ${transitions.map((t) => t.state).join(" > ")}`,
        `spoken: ${JSON.stringify(spoken.map((s) => s.text))}`,
        "--- service worker console ---",
        ...qa.swLogs,
        "--- page console (content script) ---",
        ...qa.pageLogs,
      ].join("\n"),
    });
    console.log(`[diagnostics:page] ${testInfo.title}\n  ${qa.pageLogs.join("\n  ")}`);
    console.log(
      `[diagnostics] ${testInfo.title}\n  transitions: ${transitions.map((t) => t.state).join(" > ")}\n  spoken: ${JSON.stringify(
        spoken.map((s) => s.text)
      )}\n  sw: ${qa.swLogs.join(" | ")}`
    );
  }
  await qa?.close();
  qa = null;
});

const API_KEY = { geminiApiKey: "test-key-not-a-real-key" };

/**
 * Adds a real, visible "Submit" button to the booking form, then waits for the index rebuild.
 * The fare-rules box is pre-ticked: the demo page only confirms a booking once it is (SPEC 15.7),
 * and these suites are about the voice chain, not about forgetting to accept terms.
 */
async function addSubmitButton(q: Qa): Promise<void> {
  await q.page.evaluate(() => {
    (document.getElementById("bk-terms") as HTMLInputElement).checked = true;
    const button = document.createElement("button");
    button.id = "qa-submit";
    button.type = "button";
    button.textContent = "Submit";
    document.getElementById("booking-form")!.insertBefore(button, document.getElementById("bk-confirm"));
  });
  await sleep(500); // MutationObserver debounce (150 ms) + rebuild
}

/** What a correct model returns for "fill in John Doe, then click submit, and then click confirm". */
function sequenceResponse(call: GeminiCall) {
  const els = promptElements(call);
  return {
    actions: [
      { verb: "fill", elementId: idOf(els, /passenger name/i), value: "John Doe" },
      { verb: "click", elementId: idOf(els, /^submit$/i) },
      { verb: "click", elementId: idOf(els, /confirm booking/i) },
    ],
    confidence: 0.96,
  };
}

async function routeSequence(q: Qa): Promise<void> {
  await q.routeGemini(async (route, call) => {
    await fulfillGemini(route, sequenceResponse(call));
  });
}

/** Run a route action, ignoring the error thrown when the extension already aborted the request. */
async function safely(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    // aborted by the extension: expected
  }
}

const stateNames = async (q: Qa, mark: number) => (await q.transitions()).slice(mark).map((t) => t.state);

// ===========================================================================
// Suite A — golden path and event bubbling
// ===========================================================================

test.describe("Suite A: golden path & event bubbling", () => {
  test("A1: 'Book the 9:40 flight.' — audio -> STT -> local resolver -> executor -> TTS", async () => {
    qa = await launchQa({ audio: "golden-path.wav" });
    await qa.installPageProbes();

    const { mark, source } = await qa.speak("golden-path.wav");
    await qa.waitForIdleAfter(mark);

    // True-audio evidence: the recognizer opened the fake mic, and the microphone
    // really carried speech-level signal while Space was held.
    expect(qa.sttEvents("audiostart")).toBeGreaterThanOrEqual(1);
    expect(qa.lastMicEvidence!.peak).toBeGreaterThan(0.1);
    expect(qa.lastMicEvidence!.activeMs).toBeGreaterThan(800);
    console.log(
      `[A1] transcript source: ${source}; mic evidence ${JSON.stringify(qa.lastMicEvidence)}; ` +
        `real recognizer heard: ${JSON.stringify(qa.realTranscripts())}`
    );

    // State machine walked the whole chain.
    const seen = await stateNames(qa, mark);
    for (const s of ["LISTENING", "TRANSCRIBING", "RESOLVING", "EXECUTING", "CONFIRMING", "IDLE"]) {
      expect(seen, `state ${s} missing from ${seen.join(">")}`).toContain(s);
    }
    expect(seen.indexOf("RESOLVING")).toBeLessThan(seen.indexOf("EXECUTING"));
    expect(seen).not.toContain("MODEL_RESOLVING"); // tier one handled it, no model
    expect(qa.geminiCalls).toHaveLength(0);

    // DOM result.
    const dataset = await qa.page.evaluate(() => ({ ...document.body.dataset }));
    expect(dataset.selectedFlight).toBe("Select 9:40 AM flight");
    await expect(qa.page.locator("#flight-card-2")).toHaveClass(/selected/);

    // Visual confirmation: .echo-highlight on the acted element, briefly.
    const { highlights } = await qa.probe();
    expect(highlights.some((h) => h.id === "select-flight-2"), "no .echo-highlight on the 9:40 button").toBe(true);
    await expect
      .poll(async () => (await qa!.probe()).highlights.find((h) => h.id === "select-flight-2")?.off)
      .not.toBeNull();
    const done = (await qa.probe()).highlights.find((h) => h.id === "select-flight-2")!;
    expect(done.off! - done.on).toBeGreaterThan(250);
    expect(done.off! - done.on).toBeLessThan(900);

    // Spoken confirmation (SPEC 10.6.3, fast: "{name}.").
    expect((await qa.spoken()).map((s) => s.text)).toContain("Select 9:40 AM flight.");
  });

  test("A2: fill dispatches bubbling input+change and is visible to a React-style value tracker", async () => {
    qa = await launchQa({ audio: "fill-from.wav" });
    await qa.installPageProbes();
    await qa.attachReactTracker("#from");

    const { mark } = await qa.speak("fill-from.wav");
    await qa.waitForIdleAfter(mark);

    expect(await qa.page.inputValue("#from")).toBe("toronto");

    const probe = await qa.probe();
    // bubbles:true — the document-level (bubble phase) listeners saw them.
    expect(probe.bubbled).toContainEqual({ type: "input", id: "from" });
    expect(probe.bubbled).toContainEqual({ type: "change", id: "from" });
    // The framework's tracker must have registered a change, i.e. the write
    // went through the native prototype setter, not the tracked instance one.
    expect(probe.reactChanges).toEqual(["toronto"]);

    expect(probe.highlights.some((h) => h.id === "from")).toBe(true);
    expect((await qa.spoken()).map((s) => s.text)).toContain("toronto in From.");
  });
});

// ===========================================================================
// Suite B — chaos DOM & timing traps
//
// The model returns a three step batch: fill "Passenger name", click "Submit",
// click "Confirm booking". Step 3's target is sabotaged from inside step 2's
// click handler, i.e. inside the 250 ms execution delay, so the executor's
// per-action re-resolution (SPEC 12.8) is the only thing standing between the
// page and a wrong click.
// ===========================================================================

test.describe("Suite B: chaos DOM & timing traps", () => {
  async function armChaos(q: Qa, kind: "move" | "remove" | "disable"): Promise<void> {
    await q.page.evaluate((k) => {
      const norm = (el: Element) => {
        const r = el.getBoundingClientRect();
        const de = document.documentElement;
        return {
          x: (r.left + window.scrollX + r.width / 2) / Math.max(de.scrollWidth, 1),
          y: (r.top + window.scrollY + r.height / 2) / Math.max(de.scrollHeight, 1),
        };
      };
      document.getElementById("qa-submit")!.addEventListener(
        "click",
        () => {
          const target = document.getElementById("bk-confirm") as HTMLButtonElement;
          const before = norm(target);
          if (k === "move") {
            target.style.position = "absolute";
            target.style.left = "0";
            target.style.top = "0";
          } else if (k === "remove") {
            target.remove();
          } else {
            target.disabled = true;
          }
          const after = k === "remove" ? null : norm(target);
          (window as unknown as { __chaos: unknown }).__chaos = {
            before,
            after,
            distance: after ? Math.hypot(after.x - before.x, after.y - before.y) : null,
          };
        },
        { once: true }
      );
    }, kind);
  }

  async function runChaos(kind: "move" | "remove" | "disable"): Promise<{ q: Qa; mark: number }> {
    const q = (qa = await launchQa({ audio: "sequence.wav", settings: API_KEY }));
    await addSubmitButton(q);
    await q.installPageProbes();
    await routeSequence(q);
    await armChaos(q, kind);
    const { mark } = await q.speak("sequence.wav");
    await q.waitForIdleAfter(mark, 15_000);
    return { q, mark };
  }

  async function expectAbortedAtStepThree(q: Qa, mark: number): Promise<void> {
    // Steps 1 and 2 stay applied (SPEC 16 F-12) ...
    expect(await q.page.inputValue("#bk-name")).toBe("John Doe");
    const probe = await q.probe();
    expect(probe.clicks).toContain("qa-submit");
    // ... step 3 never lands, and the booking was not confirmed.
    expect(probe.clicks).not.toContain("bk-confirm");
    expect(await q.page.evaluate(() => document.body.dataset.bookingStatus)).toBeUndefined();

    const states = await stateNames(q, mark);
    expect(states).toContain("EXECUTING");
    expect(states).toContain("ERROR"); // ACTION_FAILED -> ERROR -> IDLE (SPEC 4.5)
    expect(states).not.toContain("CONFIRMING");
    expect(states[states.length - 1]).toBe("IDLE");

    // One sentence that names the step that failed (SPEC 6.12, 10.6.3 fast).
    expect((await q.spoken()).map((x) => x.text)).toEqual(["Stopped at Confirm booking."]);
  }

  test("B1: target moves >0.15 normalized units during the execution delay -> aborted", async () => {
    const { q, mark } = await runChaos("move");
    const chaos = await q.page.evaluate(() => (window as unknown as { __chaos: { distance: number } }).__chaos);
    expect(chaos.distance, "chaos did not move the element far enough to be a valid test").toBeGreaterThan(0.15);
    await expectAbortedAtStepThree(q, mark);
  });

  test("B2: target disappears from the DOM right before execution -> not_found, batch aborted", async () => {
    const { q, mark } = await runChaos("remove");
    await expectAbortedAtStepThree(q, mark);
  });

  test("B3: target becomes disabled right before the click -> not_actionable, batch aborted", async () => {
    const { q, mark } = await runChaos("disable");
    expect(
      await q.page.evaluate(() => (document.getElementById("bk-confirm") as HTMLButtonElement).disabled)
    ).toBe(true);
    await expectAbortedAtStepThree(q, mark);
  });

  test("B4: control run - unsabotaged, the same batch completes the booking", async () => {
    const q = (qa = await launchQa({ audio: "sequence.wav", settings: API_KEY }));
    await addSubmitButton(q);
    await q.installPageProbes();
    await routeSequence(q);
    const { mark } = await q.speak("sequence.wav");
    await q.waitForIdleAfter(mark, 15_000);

    expect(await q.page.evaluate(() => document.body.dataset.bookingStatus)).toBe("confirmed");
    expect((await q.probe()).clicks).toEqual(expect.arrayContaining(["qa-submit", "bk-confirm"]));
    expect((await q.spoken()).map((x) => x.text)).toEqual(["Done. 3 steps."]);
    expect(q.geminiCalls).toHaveLength(1);
  });
});

// ===========================================================================
// Suite C — state machine & interruption
// ===========================================================================

test.describe("Suite C: state machine & interruption", () => {
  test("C0: 5 s of silence through the real microphone path -> no-speech, silent return to IDLE", async () => {
    qa = await launchQa({ audio: "silence.wav", settings: API_KEY, ignoreRealStt: false });
    const mark = await qa.holdAndSpeak("silence.wav"); // no transcript is ever injected
    await qa.waitForIdleAfter(mark, 10_000);

    // The recognizer opened the mic, the mic carried nothing (contrast with A1), and the
    // recognizer ended with no result. (Its own `speechstart` is not asserted: Chrome's
    // endpointer fires it on digital silence too.)
    expect(qa.sttEvents("audiostart")).toBeGreaterThanOrEqual(1);
    expect(qa.lastMicEvidence!.peak).toBeLessThan(0.001); // float noise, not signal
    expect(qa.lastMicEvidence!.activeMs).toBe(0);
    expect(qa.swLogs.some((l) => l.includes("stt.error no-speech"))).toBe(true);

    expect(await stateNames(qa, mark)).toEqual(["LISTENING", "TRANSCRIBING", "IDLE"]);
    expect(await qa.spoken()).toEqual([]); // SPEC 10.5: no-speech is never spoken
    expect(qa.geminiCalls).toHaveLength(0);
  });

  test("C1: talking over a long spoken confirmation stops chrome.tts, resets to LISTENING and starts a new capture", async () => {
    qa = await launchQa({
      audio: "sequence.wav",
      settings: { ...API_KEY, verbosity: "verbose", ttsRate: 0.8 },
    });
    await addSubmitButton(qa);
    await qa.installPageProbes();
    await routeSequence(qa);

    await qa.speak("sequence.wav");
    await qa.waitForState("CONFIRMING", 15_000);
    const longText = (await qa.spoken()).map((x) => x.text).join(" ");
    expect(longText).toBe("Done. I filled Passenger name, then clicked Submit, then clicked Confirm booking.");
    await expect.poll(() => qa!.isSpeaking(), { timeout: 8000 }).toBe(true);

    // Talk over it: the next take is the "click search flights" command.
    qa.setAudio("click-search.wav");
    const startsBefore = qa.sttEvents("audiostart");
    const mark = (await qa.transitions()).length;
    const t0 = Date.now();
    await qa.page.keyboard.down("Space");

    let stoppedAt: number | null = null;
    while (Date.now() - t0 < 3000) {
      if (!(await qa.isSpeaking())) {
        stoppedAt = Date.now();
        break;
      }
      await sleep(10);
    }
    expect(stoppedAt, "chrome.tts was still speaking 3 s after KEY_DOWN").not.toBeNull();
    console.log(`[C1] chrome.tts stopped ${stoppedAt! - t0} ms after KEY_DOWN`);
    expect(stoppedAt! - t0).toBeLessThan(500);
    expect((await qa.stopCalls()).some((t) => t >= t0)).toBe(true);

    // State reset and a new capture begins.
    await qa.waitForSeen("LISTENING", mark, 3000);
    await expect.poll(() => qa!.sttEvents("audiostart"), { timeout: 8000 }).toBeGreaterThan(startsBefore);
    await sleep(wavSeconds("click-search.wav") * 1000);
    await qa.page.keyboard.up("Space");
    await qa.deliverTranscript("click-search.wav");
    await qa.waitForIdleAfter(mark, 12_000);

    // The interrupted confirmation never resumed; the new command ran.
    expect((await qa.probe()).clicks).toContain("search-btn");
    const spokenAfter = (await qa.spoken()).map((x) => x.text);
    expect(spokenAfter[spokenAfter.length - 1]).toBe("Clicked Search flights.");
    expect(await qa.isSpeaking()).toBe(false);
  });

  test("C2: talking over ElevenLabs playback stops the audio immediately and starts a new capture", async () => {
    qa = await launchQa({
      audio: "golden-path.wav",
      settings: { useLocalTts: false, elevenLabsApiKey: "sk_test_not_a_real_key" },
    });
    await qa.installPageProbes();
    await qa.ctx.route(ELEVENLABS_URL_GLOB, (route) =>
      route.fulfill({ status: 200, contentType: "audio/mpeg", body: toneWav(12) })
    );

    await qa.speak("golden-path.wav");
    // Playback really started in the tab: tts.play is outstanding and the tab is audible.
    await expect
      .poll(async () => (await qa!.ttsMessages()).some((m) => m.type === "tts.play" && m.doneAt === null), {
        timeout: 8000,
      })
      .toBe(true);
    await expect.poll(() => qa!.tabAudible(), { timeout: 5000 }).toBe(true);
    expect(await qa.spoken()).toEqual([]); // cloud path: chrome.tts was not used

    qa.setAudio("click-search.wav");
    const startsBefore = qa.sttEvents("audiostart");
    const mark = (await qa.transitions()).length;
    const t0 = Date.now();
    await qa.page.keyboard.down("Space");

    await expect
      .poll(async () => (await qa!.ttsMessages()).find((m) => m.type === "tts.play")?.doneAt ?? null, {
        timeout: 3000,
      })
      .not.toBeNull();
    const messages = await qa.ttsMessages();
    const play = messages.find((m) => m.type === "tts.play")!;
    const stop = messages.find((m) => m.type === "tts.stop");
    console.log(`[C2] ElevenLabs playback ended ${play.doneAt! - t0} ms after KEY_DOWN (clip is 12 s)`);
    expect(stop, "no tts.stop was sent to the content script").toBeTruthy();
    expect(stop!.sentAt - t0).toBeLessThan(500);
    expect(play.doneAt! - t0).toBeLessThan(700);
    await expect.poll(() => qa!.tabAudible(), { timeout: 4000 }).toBe(false);

    await qa.waitForSeen("LISTENING", mark, 3000);
    await expect.poll(() => qa!.sttEvents("audiostart"), { timeout: 8000 }).toBeGreaterThan(startsBefore);
    await sleep(wavSeconds("click-search.wav") * 1000);
    await qa.page.keyboard.up("Space");
    await qa.deliverTranscript("click-search.wav");
    await qa.waitForIdleAfter(mark, 15_000);
    expect((await qa.probe()).clicks).toContain("search-btn");
  });

  test("C3: KEY_DOWN while ElevenLabs is still fetching aborts the request; no audio and no local fallback", async () => {
    qa = await launchQa({
      audio: "golden-path.wav",
      settings: { useLocalTts: false, elevenLabsApiKey: "sk_test_not_a_real_key" },
    });
    await qa.ctx.route(ELEVENLABS_URL_GLOB, async (route) => {
      await sleep(6000);
      await safely(() => route.fulfill({ status: 200, contentType: "audio/mpeg", body: toneWav(3) }));
    });

    await qa.speak("golden-path.wav");
    await qa.waitForSeen("CONFIRMING", 0, 8000);
    await sleep(300);

    qa.setAudio("silence.wav");
    await qa.ignoreRealStt(false); // the interrupting take is silence: let the real no-speech through
    const t0 = Date.now();
    await qa.page.keyboard.down("Space");
    await expect
      .poll(async () => (await qa!.fetchLog()).find((f) => f.url.includes("elevenlabs"))?.error ?? null, {
        timeout: 2000,
      })
      .toMatch(/abort/i);
    const fetched = (await qa.fetchLog()).find((f) => f.url.includes("elevenlabs"))!;
    expect(fetched.respondedAt - t0).toBeLessThan(500);

    await sleep(1500);
    await qa.page.keyboard.up("Space");
    expect((await qa.ttsMessages()).filter((m) => m.type === "tts.play")).toHaveLength(0);
    expect(await qa.spoken()).toEqual([]);
  });

  test("C4: KEY_DOWN while the model request is in flight aborts it and discards the pending actions", async () => {
    qa = await launchQa({ audio: "sequence.wav", settings: API_KEY });
    await addSubmitButton(qa);
    await qa.installPageProbes();
    await qa.routeGemini(async (route, call) => {
      await sleep(2000);
      await safely(() => fulfillGemini(route, sequenceResponse(call)));
    });

    await qa.speak("sequence.wav");
    await qa.waitForState("MODEL_RESOLVING", 5000);

    qa.setAudio("silence.wav");
    await qa.ignoreRealStt(false); // the interrupting take is silence: let the real no-speech through
    const markC4 = (await qa.transitions()).length;
    const t0 = Date.now();
    await qa.page.keyboard.down("Space");
    await qa.waitForSeen("LISTENING", markC4, 3000);
    await expect
      .poll(async () => (await qa!.fetchLog()).find((f) => f.url.includes("googleapis"))?.error ?? null, {
        timeout: 2000,
      })
      .toMatch(/abort/i);
    const fetched = (await qa.fetchLog()).find((f) => f.url.includes("googleapis"))!;
    expect(fetched.respondedAt - t0).toBeLessThan(500);

    await sleep(2500); // well past the moment the (aborted) model reply would have landed
    expect(await stateNames(qa, markC4)).not.toContain("EXECUTING");
    expect(await qa.page.inputValue("#bk-name")).toBe("");
    expect((await qa.probe()).clicks).toEqual([]);

    await qa.page.keyboard.up("Space");
    await qa.waitForState("IDLE", 8000);
    expect(await qa.spoken()).toEqual([]);
  });

  test("C6: after a voice fill, Space still starts a new capture instead of being typed into the field", async () => {
    qa = await launchQa({ audio: "fill-from.wav" });
    await qa.installPageProbes();
    const first = await qa.speak("fill-from.wav");
    await qa.waitForIdleAfter(first.mark, 12_000);
    expect(await qa.page.inputValue("#from")).toBe("toronto");

    // The field the executor just filled must not keep the keyboard focus: the very
    // next press is the user talking, not typing (SPEC 6.1 only exempts real typing).
    const focused = await qa.page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
    expect(focused).not.toBe("from");

    qa.setAudio("click-search.wav");
    const startsBefore = qa.sttEvents("audiostart");
    const mark = (await qa.transitions()).length;
    await qa.page.keyboard.down("Space");
    await qa.waitForSeen("LISTENING", mark, 3000);
    await expect.poll(() => qa!.sttEvents("audiostart"), { timeout: 8000 }).toBeGreaterThan(startsBefore);
    await sleep(wavSeconds("click-search.wav") * 1000);
    await qa.page.keyboard.up("Space");
    await qa.deliverTranscript("click-search.wav");
    await qa.waitForIdleAfter(mark, 12_000);

    expect(await qa.page.inputValue("#from")).toBe("toronto"); // no stray space typed
    expect((await qa.probe()).clicks).toContain("search-btn");
  });

  test("C5: OS key auto-repeat while holding Space does not restart the capture", async () => {
    qa = await launchQa({ audio: "click-search.wav" });
    await qa.installPageProbes();
    const mark = (await qa.transitions()).length;
    await qa.page.bringToFront();
    await qa.page.keyboard.down("Space");
    await expect.poll(() => qa!.sttEvents("audiostart"), { timeout: 8000 }).toBe(1);
    for (let i = 0; i < 4; i++) {
      await qa.page.keyboard.down("Space"); // already down => Playwright sends keydown with repeat:true
      await sleep(120);
    }
    expect(qa.sttEvents("audiostart")).toBe(1);
    expect(await qa.sessionState()).toBe("LISTENING");

    await sleep(Math.max(0, wavSeconds("click-search.wav") * 1000 - 600));
    await qa.page.keyboard.up("Space");
    await qa.deliverTranscript("click-search.wav");
    await qa.waitForIdleAfter(mark, 12_000);
    expect((await qa.probe()).clicks).toContain("search-btn");
    expect(qa.sttEvents("audiostart")).toBe(1);
  });
});

// ===========================================================================
// Suite D — AI fallback & network hostility
// ===========================================================================

test.describe("Suite D: AI fallback & network hostility", () => {
  async function setup(): Promise<Qa> {
    const q = (qa = await launchQa({ audio: "sequence.wav", settings: API_KEY }));
    await addSubmitButton(q);
    await q.installPageProbes();
    return q;
  }

  const geminiFetches = async (q: Qa) => (await q.fetchLog()).filter((f) => f.url.includes("googleapis"));

  test("D1: model slower than 2500 ms -> aborted, spoken failure, no retry, extension keeps working", async () => {
    const q = await setup();
    await q.routeGemini(async (route, call) => {
      await sleep(3200);
      await safely(() => fulfillGemini(route, sequenceResponse(call)));
    });

    const { mark } = await q.speak("sequence.wav");
    await q.waitForIdleAfter(mark, 15_000);

    expect(q.geminiCalls).toHaveLength(1); // a retry would double perceived latency (SPEC 11.4 rule 2)
    const spoken = await q.spoken();
    expect(spoken.map((x) => x.text)).toEqual(["I couldn't reach the model."]);
    const elapsed = spoken[0].at - q.geminiCalls[0].at;
    console.log(`[D1] model timeout -> spoken failure in ${elapsed} ms (limit 2500)`);
    expect(elapsed).toBeGreaterThanOrEqual(2400);
    expect(elapsed).toBeLessThan(3400);
    const [fetched] = await geminiFetches(q);
    expect(fetched.error).toMatch(/abort/i);

    // Graceful: nothing was executed, and the tier-one path still works afterwards.
    expect(await q.page.inputValue("#bk-name")).toBe("");
    expect((await q.probe()).clicks).toEqual([]);
    const next = await q.speak("click-search.wav");
    await q.waitForIdleAfter(next.mark, 12_000);
    expect((await q.probe()).clicks).toContain("search-btn");
  });

  test("D2: HTTP 500 twice -> exactly one retry, 300 ms after the failure, then a spoken failure", async () => {
    const q = await setup();
    await q.routeGemini((route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"message":"boom"}}' })
    );

    const { mark } = await q.speak("sequence.wav");
    await q.waitForIdleAfter(mark, 15_000);
    await sleep(800); // a wrongly-added third attempt would show up here

    const fetches = await geminiFetches(q);
    expect(fetches.map((f) => f.status)).toEqual([500, 500]);
    const retryDelay = fetches[1].issuedAt - fetches[0].respondedAt;
    console.log(`[D2] retry issued ${retryDelay} ms after the 500`);
    expect(retryDelay).toBeGreaterThanOrEqual(300);
    expect(retryDelay).toBeLessThan(360);
    expect((await q.spoken()).map((x) => x.text)).toEqual(["I couldn't reach the model."]);
    expect((await q.probe()).clicks).toEqual([]);
  });

  test("D2b: HTTP 500 then success -> the retry's answer is executed", async () => {
    const q = await setup();
    await q.routeGemini(async (route, call, n) => {
      if (n === 1) return route.fulfill({ status: 500, body: "upstream error" });
      return fulfillGemini(route, sequenceResponse(call));
    });

    const { mark } = await q.speak("sequence.wav");
    await q.waitForIdleAfter(mark, 15_000);

    const fetches = await geminiFetches(q);
    expect(fetches.map((f) => f.status)).toEqual([500, 200]);
    const retryDelay = fetches[1].issuedAt - fetches[0].respondedAt;
    expect(retryDelay).toBeGreaterThanOrEqual(300);
    expect(retryDelay).toBeLessThan(360);
    expect(await q.page.evaluate(() => document.body.dataset.bookingStatus)).toBe("confirmed");
    expect((await q.spoken()).map((x) => x.text)).toEqual(["Done. 3 steps."]);
  });

  test("D3: hallucinated elementId (el_9999) is rejected by the validation layer; nothing executes", async () => {
    const q = await setup();
    await q.routeGemini((route, call) => {
      const els = promptElements(call);
      return fulfillGemini(route, {
        actions: [
          // a perfectly valid first step ...
          { verb: "fill", elementId: idOf(els, /passenger name/i), value: "John Doe" },
          // ... followed by an id the model invented
          { verb: "click", elementId: "el_9999" },
        ],
        confidence: 0.97,
      });
    });

    const { mark } = await q.speak("sequence.wav");
    await q.waitForIdleAfter(mark, 12_000);

    const states = await stateNames(q, mark);
    expect(states).toContain("MODEL_RESOLVING");
    expect(states).not.toContain("EXECUTING"); // rejected before dispatch
    expect(q.swLogs.some((l) => l.includes("Element id not in index: el_9999"))).toBe(true);
    // The whole batch is refused: not even the valid first step was applied (SPEC 7.6.1).
    expect(await q.page.inputValue("#bk-name")).toBe("");
    expect((await q.probe()).clicks).toEqual([]);
    expect((await q.spoken()).map((x) => x.text)).toEqual(["I'm not sure which one you mean."]);
  });

  test("D4: HTTP 401 disables the model tier for the session; the second command never reaches the network", async () => {
    const q = await setup();
    await q.routeGemini((route) => route.fulfill({ status: 401, body: '{"error":{"message":"API key not valid"}}' }));

    const first = await q.speak("sequence.wav");
    await q.waitForIdleAfter(first.mark, 12_000);
    const second = await q.speak("sequence.wav");
    await q.waitForIdleAfter(second.mark, 12_000);

    expect(q.geminiCalls).toHaveLength(1);
    expect((await q.spoken()).map((x) => x.text)).toEqual([
      "Your API key isn't working.",
      "Your API key isn't working.",
    ]);
    expect((await q.probe()).clicks).toEqual([]);
  });

  test("D5: HTTP 429 is not retried", async () => {
    const q = await setup();
    await q.routeGemini((route) => route.fulfill({ status: 429, body: "{}" }));

    const { mark } = await q.speak("sequence.wav");
    await q.waitForIdleAfter(mark, 12_000);
    await sleep(800);

    expect(q.geminiCalls).toHaveLength(1);
    // DEV-007: the API's status text is logged, never read aloud.
    expect((await q.spoken()).map((x) => x.text)).toEqual(["I'm busy right now. Try again in a moment."]);
  });

  test("D6: request carries the key in a header only, and no page URL or password data", async () => {
    const q = await setup();
    let headers: Record<string, string> = {};
    let url = "";
    await q.routeGemini((route, call) => {
      headers = route.request().headers();
      url = route.request().url();
      return fulfillGemini(route, sequenceResponse(call));
    });
    const { mark } = await q.speak("sequence.wav");
    await q.waitForIdleAfter(mark, 15_000);

    expect(headers["x-goog-api-key"]).toBe(API_KEY.geminiApiKey);
    expect(url).not.toContain(API_KEY.geminiApiKey);
    expect(url).not.toContain("key=");
    const body = JSON.stringify(q.geminiCalls[0].body);
    expect(body).not.toContain("127.0.0.1");
    expect(body).not.toMatch(/password/i);
  });
});

// ===========================================================================
// Suite E — ambiguity & clarification loop
// ===========================================================================

test.describe("Suite E: ambiguity & clarification loop", () => {
  const candidates = (q: Qa) => q.page.locator(".echo-candidate");
  const lastDownload = (q: Qa) => q.page.evaluate(() => document.body.dataset.lastDownload);

  test("E1: two identical 'Download' buttons -> CLARIFYING, a question is spoken, then 'the second one' clicks the Word download", async () => {
    qa = await launchQa({ audio: "ambiguity-trap.wav" });
    await qa.installPageProbes();

    const first = await qa.speak("ambiguity-trap.wav");
    await qa.waitForState("CLARIFYING", 8000);

    // The gate refused to guess (SPEC 7.4): nothing was clicked, no model call.
    expect(await lastDownload(qa)).toBeUndefined();
    expect((await qa.probe()).clicks).toEqual([]);
    expect(qa.geminiCalls).toHaveLength(0);
    const states = await stateNames(qa, first.mark);
    expect(states).toEqual(expect.arrayContaining(["RESOLVING", "CLARIFYING"]));
    expect(states).not.toContain("EXECUTING");

    // The question is spoken (SPEC 7.5.1 level 3: identical names, same region -> ordinal) and pinned.
    await expect.poll(async () => (await qa!.spoken()).length, { timeout: 5000 }).toBe(1);
    const question = (await qa.spoken())[0].text;
    console.log(`[E1] spoken question: "${question}"`);
    expect(question).toBe("The first one or the second one?");
    expect(question.split(/\s+/).length).toBeLessThanOrEqual(9);
    const pinned = (await qa.session()).clarification as { candidateIds: string[]; question: string };
    expect(pinned.candidateIds).toHaveLength(2);
    expect(pinned.question).toBe(question);

    // Both candidates highlighted at once, and only they.
    await expect(candidates(qa)).toHaveCount(2);
    await expect(qa.page.locator("#dl-pdf")).toHaveClass(/echo-candidate/);
    await expect(qa.page.locator("#dl-word")).toHaveClass(/echo-candidate/);

    // The user answers with a second, different utterance.
    const second = await qa.speak("clarify-second.wav");
    await qa.waitForIdleAfter(second.mark, 12_000);

    expect(await lastDownload(qa)).toBe("word"); // document order: PDF is first, Word is second
    expect((await qa.probe()).clicks).toEqual(["dl-word"]);
    await expect(candidates(qa)).toHaveCount(0); // cleared on IDLE (F-09)
    expect((await qa.session()).clarification ?? null).toBeNull();
    expect((await qa.spoken()).map((x) => x.text)).toEqual([question, "Download."]);
    expect(qa.geminiCalls).toHaveLength(0);
  });

  test("E2: no answer for 15 s -> the clarification is discarded and the candidates un-highlighted", async () => {
    test.setTimeout(120_000);
    qa = await launchQa({ audio: "ambiguity-trap.wav" });
    await qa.speak("ambiguity-trap.wav");
    await qa.waitForState("CLARIFYING", 8000);
    await expect(candidates(qa)).toHaveCount(2);

    await sleep(13_000);
    expect(await qa.sessionState()).toBe("CLARIFYING");
    await qa.waitForState("IDLE", 5000);

    await expect(candidates(qa)).toHaveCount(0);
    expect((await qa.session()).clarification ?? null).toBeNull();
    expect(await lastDownload(qa)).toBeUndefined();
  });

  test("E3: the page changes during clarification -> stale candidates are discarded, never clicked", async () => {
    qa = await launchQa({ audio: "ambiguity-trap.wav" });
    await qa.speak("ambiguity-trap.wav");
    await qa.waitForState("CLARIFYING", 8000);

    await qa.page.evaluate(() => {
      const b = document.createElement("button");
      b.textContent = "Late banner";
      document.body.appendChild(b);
    });
    await sleep(500); // observer rebuild => new buildId

    const second = await qa.speak("clarify-second.wav");
    await qa.waitForIdleAfter(second.mark, 12_000);

    expect(await lastDownload(qa)).toBeUndefined();
    await expect(candidates(qa)).toHaveCount(0);
    expect((await qa.session()).clarification ?? null).toBeNull();
  });

  test("E4: an unintelligible reply is asked once more ('Say ...'), and never a third time", async () => {
    qa = await launchQa({ audio: "ambiguity-trap.wav" });
    await qa.speak("ambiguity-trap.wav");
    await qa.waitForState("CLARIFYING", 8000);

    await qa.speak("clarify-second.wav", { transcript: "banana" });
    await expect.poll(async () => (await qa!.spoken()).length, { timeout: 8000 }).toBe(2);
    expect((await qa.spoken())[1].text).toBe("Say the first one or the second one?");
    await qa.waitForState("CLARIFYING", 4000);

    const again = await qa.speak("clarify-second.wav", { transcript: "banana" });
    await qa.waitForIdleAfter(again.mark, 12_000);
    expect((await qa.spoken()).map((x) => x.text)).toEqual([
      "The first one or the second one?",
      "Say the first one or the second one?",
      "I'm not sure which one you mean.",
    ]);
    expect(await lastDownload(qa)).toBeUndefined();
    await expect(candidates(qa)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Suite F: global (browser) commands — SPEC 6.18, F-15. Transcripts go through
// the real service-worker pipeline; the page never sees them, and a Gemini spy
// proves none of them reaches the model.
// ---------------------------------------------------------------------------

test.describe("Suite F: global commands (tabs, search, save)", () => {
  async function setup(): Promise<Qa> {
    // A key is configured so a routing leak would show up as a real model call.
    const q = (qa = await launchQa({ audio: "silence.wav", settings: API_KEY }));
    await q.routeGemini((route) => route.fulfill({ status: 500, body: "{}" }));
    // Record the URL every chrome.tabs.create asks for, and open about:blank in
    // its place: a tab's first navigation happens before Playwright's routing
    // can intercept it, and the test must never touch the real network.
    await q.sw.evaluate(() => {
      const g = globalThis as unknown as { __qaCreated: Array<string | null> };
      g.__qaCreated = [];
      const real = chrome.tabs.create.bind(chrome.tabs);
      (chrome.tabs as unknown as { create: unknown }).create = (props: chrome.tabs.CreateProperties) => {
        g.__qaCreated.push(props.url ?? null);
        return real(props.url ? { ...props, url: "about:blank" } : props);
      };
    });
    return q;
  }

  const createdUrls = (q: Qa) =>
    q.sw.evaluate(() => (globalThis as unknown as { __qaCreated: Array<string | null> }).__qaCreated);

  /** Inject one transcript, wait for its sentence to be spoken and the session to settle. */
  async function say(q: Qa, transcript: string, expectSpoken: string): Promise<void> {
    // key.down remembers the tab the user pressed the key in; the injected
    // transcript has no key press, so remember the front tab the same way.
    await q.sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      await chrome.storage.session.set({ activeTab: tab?.id });
    });
    const before = (await q.spoken()).length;
    const mark = (await q.transitions()).length;
    await q.deliverTranscript("silence.wav", transcript);
    await expect
      .poll(async () => (await q.spoken()).slice(before).map((x) => x.text), { timeout: 8000 })
      .toEqual([expectSpoken]);
    await q.waitForIdleAfter(mark, 8000);
  }

  const activeUrl = (q: Qa) =>
    q.sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url ?? "");

  test("F1: search, save to Keep, switch tab, new tab, close tab; the model is never called", async () => {
    const q = await setup();
    const demoUrl = q.page.url();

    // "search for waterloo" -> Google, query encoded (F-15 criterion).
    const searchTab = q.ctx.waitForEvent("page");
    await say(q, "Search for waterloo & kitchener.", "Searching Google for waterloo & kitchener.");
    const search = await searchTab;
    const [searchUrl] = await createdUrls(q);
    expect(searchUrl?.startsWith("https://www.google.com/search?q=")).toBe(true);
    expect(new URL(searchUrl!).searchParams.get("q")).toBe("waterloo & kitchener");

    // Back to the demo page, then "save this page" -> Keep with its title and URL.
    await q.page.bringToFront();
    const keepTab = q.ctx.waitForEvent("page");
    await say(q, "Save this page.", "Opening Keep with this page.");
    const keep = await keepTab;
    const keepUrl = (await createdUrls(q))[1];
    expect(keepUrl?.startsWith("https://keep.google.com/#NOTE/?text=")).toBe(true);
    expect(decodeURIComponent(keepUrl!.split("text=")[1])).toBe(`Northbound Air\n${demoUrl}`);
    expect(search.isClosed()).toBe(false);

    // "switch to Northbound Air tab" from the Keep tab.
    await keep.bringToFront();
    await say(q, "Switch to the Northbound Air tab.", "Switching to Northbound Air.");
    expect(await activeUrl(q)).toBe(demoUrl);

    // "new tab" then "close tab" closes exactly that new tab.
    const pagesBefore = q.ctx.pages().length;
    const newTab = q.ctx.waitForEvent("page");
    await say(q, "Open a new tab.", "Opening new tab.");
    const blank = await newTab;
    expect(q.ctx.pages().length).toBe(pagesBefore + 1);
    await blank.bringToFront();
    await say(q, "Close this tab.", "Closing tab.");
    await expect.poll(() => blank.isClosed(), { timeout: 5000 }).toBe(true);
    expect(q.ctx.pages().length).toBe(pagesBefore);

    // SPEC 6.18 / F-15: none of these commands ever reaches the Gemini client.
    expect(q.geminiCalls).toHaveLength(0);
    expect((await q.fetchLog()).filter((f) => f.url.includes("googleapis"))).toHaveLength(0);
    // Every command went EXECUTING -> CONFIRMING -> IDLE, never through the model state.
    expect((await q.transitions()).map((t) => t.state)).not.toContain("MODEL_RESOLVING");
  });

  test("F3: next tab, reload, and history move the real browser (SPEC 6.18 rows)", async () => {
    const q = await setup();
    const demoUrl = q.page.url();

    // Two tabs in the window: the demo page and the harness's extension page.
    await say(q, "Next tab.", "ECHO — Options.");
    expect(await activeUrl(q)).toContain("options.html");
    await say(q, "Previous tab.", "Northbound Air.");
    expect(await activeUrl(q)).toBe(demoUrl);

    // Reload: a marker set on the window does not survive it.
    await q.page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));
    await say(q, "Reload the page.", "Reloading.");
    await q.page.waitForLoadState("domcontentloaded");
    await expect
      .poll(() => q.page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept ?? false))
      .toBe(false);

    // History: the tab was opened at about:blank and then navigated to the demo page.
    await say(q, "Go back.", "Going back.");
    await expect.poll(() => q.page.url(), { timeout: 5000 }).toBe("about:blank");
    await say(q, "Go forward.", "Going forward.");
    await expect.poll(() => q.page.url(), { timeout: 5000 }).toBe(demoUrl);

    // Back twice lands on about:blank, where there is nothing left to go back to.
    await say(q, "Go back.", "Going back.");
    await expect.poll(() => q.page.url(), { timeout: 5000 }).toBe("about:blank");
    await say(q, "Go back.", "There's nothing to go back to.");

    expect(q.geminiCalls).toHaveLength(0);
  });

  test("F2: page commands that merely contain these words still reach the page", async () => {
    const q = await setup();
    await q.installPageProbes();
    // "Search flights" is the demo page's button, not a web search.
    const mark = (await q.transitions()).length;
    await q.deliverTranscript("silence.wav", "Click search flights.");
    await q.waitForIdleAfter(mark, 8000);
    expect(q.ctx.pages().some((p) => p.url().includes("google.com"))).toBe(false);
    expect((await q.spoken()).map((x) => x.text)).toEqual(["Search flights."]);
  });
});

// ---------------------------------------------------------------------------
// Suite G: questions about the page, the date and the tabs — SPEC 11.6, 11.7,
// F-13, F-14. Transcripts go through the real service-worker pipeline against the
// real demo page; only Gemini is stubbed, and every request it receives is checked.
// ---------------------------------------------------------------------------

test.describe("Suite G: page questions, date/time, tabs", () => {
  const ANSWER = "This is a flight booking page. You can search for flights and book one.";

  interface Body {
    contents: Array<{ parts: Array<{ text: string }> }>;
    generationConfig: { responseMimeType: string; responseSchema?: unknown };
    systemInstruction: { parts: Array<{ text: string }> };
  }
  const bodyOf = (call: GeminiCall): Body => call.body as unknown as Body;
  const isResolver = (call: GeminiCall): boolean => bodyOf(call).generationConfig.responseMimeType === "application/json";
  const answerCalls = (q: Qa): GeminiCall[] => q.geminiCalls.filter((c) => !isResolver(c));
  type Settings = Parameters<typeof launchQa>[0]["settings"];

  async function setup(settings: Settings = API_KEY): Promise<Qa> {
    const q = (qa = await launchQa({ audio: "silence.wav", settings }));
    await q.routeGemini(async (route, call) => {
      if (isResolver(call)) {
        // A resolver call: the only command here that needs one clicks the "destination" link.
        const els = promptElements(call);
        await fulfillGemini(route, { actions: [{ verb: "click", elementId: idOf(els, /destination/i) }], confidence: 0.95 });
        return;
      }
      const pageText = bodyOf(call).contents[0].parts[2].text;
      const text = pageText.includes("runway lights")
        ? "It leads to a page about runway lights."
        : pageText.includes("Airport history")
          ? "This tab is about the history of airports."
          : pageText.includes("Fare panel is now open")
            ? "The fare panel is open."
            : ANSWER;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
      });
    });
    return q;
  }

  /** Inject one transcript as if spoken on the front tab, and return everything spoken for it. */
  async function ask(q: Qa, transcript: string): Promise<string[]> {
    await q.sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      await chrome.storage.session.set({ activeTab: tab?.id });
    });
    const before = (await q.spoken()).length;
    const mark = (await q.transitions()).length;
    await q.deliverTranscript("silence.wav", transcript);
    await q.waitForIdleAfter(mark, 20_000);
    return (await q.spoken()).slice(before).map((x) => x.text);
  }

  /** A second tab in the same window, titled and filled as a different page. */
  async function openAirportTab(q: Qa): Promise<void> {
    const other = await q.ctx.newPage();
    await other.goto(q.page.url());
    await other.evaluate(() => {
      document.title = "Airport - Wikipedia";
      document.body.innerHTML = "<main><h1>Airport</h1><p>Airport history: early airfields were grass strips.</p></main>";
    });
    await q.page.bringToFront();
  }

  /** A link to a stubbed page about runway lights, first in the page's reading order. */
  async function addDestinationLink(q: Qa, target?: string): Promise<void> {
    await q.ctx.route("**/qa-dest", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><head><title>Destination Page</title></head><body><main><h1>Destination</h1><p>You have reached the page about runway lights.</p></main></body></html>",
      })
    );
    await q.page.evaluate((t) => {
      const a = document.createElement("a");
      a.href = "/qa-dest";
      if (t) a.target = t;
      a.textContent = "Destination link";
      document.body.prepend(a);
    }, target ?? null);
    await sleep(500);
  }

  const frontTitle = (q: Qa) =>
    q.sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].title);

  test("G1: 'what's on this page' reads the page and speaks the model's answer, nothing else", async () => {
    const q = await setup();

    expect(await ask(q, "What's on this page?")).toEqual([ANSWER]);

    const calls = answerCalls(q);
    expect(calls).toHaveLength(1);
    const body = bodyOf(calls[0]);
    // Plain text, three separate parts, page text from the real page, and the date.
    expect(body.generationConfig.responseMimeType).toBe("text/plain");
    expect(body.generationConfig.responseSchema).toBeUndefined();
    const parts = body.contents[0].parts.map((p) => p.text);
    expect(parts[0]).toBe("<user_request>What's on this page</user_request>");
    expect(parts[1]).toMatch(/^<browser_context>.*"now":".*20\d\d.*".*<\/browser_context>$/);
    expect(parts[1]).toContain('"title":"Northbound Air"');
    expect(parts[1]).toContain("127.0.0.1");
    expect(parts[1]).not.toContain("http");
    expect(parts[2]).toContain("Northbound Air Flight Booking");
    // The system instruction is the fixed constant: no page text, no date.
    expect(body.systemInstruction.parts[0].text).not.toContain("Northbound");
    // Inert: the answer never went near the executor.
    const states = (await q.transitions()).map((t) => t.state);
    expect(states).toContain("MODEL_RESOLVING");
    expect(states).not.toContain("EXECUTING");
  });

  test("G2: a question is answered, never clicked, even when it names a button", async () => {
    const q = await setup();
    await q.page.evaluate(() => {
      const b = document.createElement("button");
      b.id = "qa-trap";
      b.textContent = "Where is the submit button";
      b.addEventListener("click", () => ((window as unknown as { __trapClicked: boolean }).__trapClicked = true));
      document.body.prepend(b);
    });
    await sleep(500);

    expect(await ask(q, "Where is the submit button?")).toEqual([ANSWER]);
    expect(await q.page.evaluate(() => (window as unknown as { __trapClicked?: boolean }).__trapClicked)).toBeUndefined();
    expect(answerCalls(q)).toHaveLength(1);
  });

  test("G3: the time, the date and the tabs are answered locally, with no key and no network", async () => {
    const q = await setup({}); // no API key at all

    const time = await ask(q, "What time is it?");
    expect(time[0]).toMatch(/^It's \d{1,2}:\d{2}\s?[AP]M\.$/);
    const date = await ask(q, "What's the date?");
    expect(date[0]).toMatch(/^Today is \w+day, \w+ \d{1,2}, 20\d\d\.$/);

    const tabs = await ask(q, "What tabs are open?");
    expect(tabs).toHaveLength(1);
    // The harness window holds the demo page, the options page and a blank tab.
    expect(tabs[0]).toMatch(/^You have \d+ tabs open\. 1, /);
    expect(tabs[0]).toContain("Northbound Air, this one");
    expect(tabs[0]).toContain("ECHO — Options");

    expect((await ask(q, "How many tabs do I have?"))[0]).toMatch(/^You have \d+ tabs open\.$/);
    expect(q.geminiCalls).toHaveLength(0);
    expect((await q.fetchLog()).filter((f) => f.url.includes("googleapis"))).toHaveLength(0);
  });

  test("G4: 'summarize the airport tab' reads the other tab in this window, without switching to it", async () => {
    const q = await setup();
    await openAirportTab(q);

    expect(await ask(q, "Summarize the airport tab.")).toEqual(["This tab is about the history of airports."]);

    const parts = bodyOf(answerCalls(q)[0]).contents[0].parts.map((p) => p.text);
    expect(parts[2]).toContain("Airport history");
    expect(parts[1]).toContain('"page":{"title":"Airport - Wikipedia"');
    expect(parts[1]).toContain("Northbound Air"); // and it knows about the other tab too
    // We read the tab; we did not move the user.
    expect(await frontTitle(q)).toBe("Northbound Air");
  });

  test("G5: 'switch to the airport tab and summarize it' switches, then answers about it", async () => {
    const q = await setup();
    await openAirportTab(q);

    const spoken = await ask(q, "Switch to the airport tab and summarize it.");
    expect(spoken).toEqual(["Switching to Airport - Wikipedia. This tab is about the history of airports."]);
    expect(await frontTitle(q)).toBe("Airport - Wikipedia");
  });

  test("G6: 'switch to Wikipedia' (no 'tab') is a tab switch when a tab matches, and a page command when none does", async () => {
    const q = await setup();
    await q.page.evaluate(() => {
      const b = document.createElement("button");
      b.textContent = "Switch to grid view";
      b.addEventListener("click", () => ((window as unknown as { __grid: boolean }).__grid = true));
      document.body.prepend(b);
    });
    await sleep(500);

    // No open tab is called "grid view": the page's own button is clicked.
    await ask(q, "Switch to grid view.");
    expect(await q.page.evaluate(() => (window as unknown as { __grid?: boolean }).__grid)).toBe(true);

    // A tab called Wikipedia exists: that is a tab switch.
    await openAirportTab(q);
    expect(await ask(q, "Switch to Wikipedia.")).toEqual(["Switching to Airport - Wikipedia."]);
    expect(await frontTitle(q)).toBe("Airport - Wikipedia");
    expect(answerCalls(q)).toHaveLength(0);
  });

  test("G7: 'click the link and tell me where it leads' clicks, waits for the new page, and answers about it", async () => {
    const q = await setup();
    await addDestinationLink(q);

    const spoken = await ask(q, "Click the destination link and tell me where it leads.");
    expect(spoken).toHaveLength(1);
    // The click's own confirmation (the element's name), then the answer, in one breath.
    expect(spoken[0]).toMatch(/^Destination link\. /);
    expect(spoken[0]).toContain("It leads to a page about runway lights.");
    expect(q.page.url().endsWith("/qa-dest")).toBe(true);

    const context = bodyOf(answerCalls(q)[0]).contents[0].parts[1].text;
    expect(context).toContain('"justNavigatedFrom":"Northbound Air"');
    expect(context).toContain('"title":"Destination Page"');
  });

  test("G7b: a link that opens a new tab: the answer is about the tab it opened", async () => {
    const q = await setup();
    await addDestinationLink(q, "_blank");

    const spoken = await ask(q, "Click the destination link and tell me where it leads.");
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toMatch(/^Destination link\. It leads to a page about runway lights\.$/);

    const context = bodyOf(answerCalls(q)[0]).contents[0].parts[1].text;
    expect(context).toContain('"title":"Destination Page"');
    expect(context).toContain('"justNavigatedFrom":"Northbound Air"');
    // The user's next command acts on the tab they were just taken to.
    expect(
      await q.sw.evaluate(async () => {
        const stored = await chrome.storage.session.get("activeTab");
        return (await chrome.tabs.get(stored.activeTab as number)).title;
      })
    ).toBe("Destination Page");
  });

  test("G7c: a click that changes the page without navigating answers about the page as it now is", async () => {
    const q = await setup();
    await q.page.evaluate(() => {
      const b = document.createElement("button");
      b.textContent = "Show fare panel";
      b.addEventListener("click", () => {
        const p = document.createElement("p");
        p.textContent = "Fare panel is now open with three fares.";
        (document.querySelector("main") ?? document.body).append(p);
      });
      document.body.prepend(b);
    });
    await sleep(500);

    expect(await ask(q, "Click show fare panel and tell me what changed.")).toEqual([
      "Show fare panel. The fare panel is open.",
    ]);
    // Nothing loaded, so nothing is described as "where the click led".
    expect(bodyOf(answerCalls(q)[0]).contents[0].parts[1].text).not.toContain("justNavigatedFrom");
  });

  test("G8: a page that cannot be read gets a sentence, and the clock still works there", async () => {
    const q = await setup();
    const blank = await q.ctx.newPage();
    await blank.goto("about:blank");
    await blank.bringToFront();

    expect(await ask(q, "Summarize this page.")).toEqual(["I can't read this page."]);
    expect(answerCalls(q)).toHaveLength(0);
    expect((await ask(q, "What time is it?"))[0]).toMatch(/^It's \d{1,2}:\d{2}/);
  });

  test("G9: model trouble is spoken as a sentence and the session returns to idle", async () => {
    const q = (qa = await launchQa({ audio: "silence.wav", settings: API_KEY }));
    await q.routeGemini((route) => route.fulfill({ status: 429, body: "{}" }));
    expect(await ask(q, "Summarize this page.")).toEqual(["I'm busy right now. Try again in a moment."]);
    expect((await q.transitions()).at(-1)?.state).toBe("IDLE");
  });

  test("G9b: with no key, a question says how to add one", async () => {
    const q = await setup({});
    expect(await ask(q, "What's on this page?")).toEqual(["Add your API key in the extension options."]);
  });

  test("G10: the resolver gets the date and the page's title, but not the tab list or an address", async () => {
    const q = await setup();
    await addSubmitButton(q);
    await q.routeGemini(async (route, call) => {
      await fulfillGemini(route, sequenceResponse(call));
    });

    await ask(q, "Fill in John Doe, then click submit, and then click confirm booking.");

    const resolverCalls = q.geminiCalls.filter(isResolver);
    expect(resolverCalls.length).toBeGreaterThanOrEqual(1);
    const parts = bodyOf(resolverCalls[0]).contents[0].parts.map((p) => p.text);
    expect(parts).toHaveLength(3);
    expect(parts[2]).toMatch(/^<browser_context>/);
    expect(parts[2]).toContain('"now"');
    expect(parts[2]).toContain('"title":"Northbound Air"');
    expect(parts[2]).not.toContain('"tabs"');
    expect(parts[2]).not.toContain("127.0.0.1"); // no address reaches the resolver (SPEC 8.3)
    expect(bodyOf(resolverCalls[0]).systemInstruction.parts[0].text).not.toMatch(/20\d\d/);
  });
});
