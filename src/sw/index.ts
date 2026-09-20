/**
 * Service worker entry point — SPEC §4.1, §4.5, §5.15, §5.16
 *
 * Responsibilities wired here:
 *   - On install: re-inject content script into open tabs.
 *   - key.down: mic permission check → ensureOffscreen → LISTENING → stt.start
 *   - key.up:   TRANSCRIBING → stt.stop (watchdog cleared by session.ts)
 *   - stt.result: accumulate interim, act on final → RESOLVING
 *   - stt.error: per SPEC §10.5 handling table
 *   - state.get: return current session state
 *   - test.transcript (DEV only): inject transcript for automated tests §17.3
 *
 * Exports from sub-modules remain for test access.
 */

import { ENVELOPE_NS, isEnvelopeFor } from "../shared/contracts";
import type { Envelope } from "../shared/contracts";
import {
  HOLD_MIN_DURATION_MS,
  QA_IGNORE_STT_KEY,
  RECOGNITION_MODE_KEY,
} from "../shared/constants";
import {
  transitionTo,
  getSession,
  updateTranscript,
  setOnWatchdogFired,
  setOnTranscribingTimeout,
  setOnClarifyTimeout,
} from "./session";
import { ensureMicPermission, ensureOffscreen, resetMicGranted } from "./mic";
import { speakFromSettings, stopTts } from "./tts";
import { cancelPipeline, rememberTab, runPipeline } from "./pipeline";

// ---------------------------------------------------------------------------
// Content script re-injection on install (SPEC §8.7 `scripting`)
// ---------------------------------------------------------------------------

const CONTENT_SCRIPT_FILE = "src/content/index.js";

async function reinjectContentScript(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: "<all_urls>" });
  await Promise.all(
    tabs
      .filter((tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === "number")
      .map((tab) =>
        chrome.scripting
          .executeScript({ target: { tabId: tab.id }, files: [CONTENT_SCRIPT_FILE] })
          .catch(() => {
            // Tabs the extension cannot script into are expected to reject.
          })
      )
  );
}

chrome.runtime.onInstalled.addListener(() => {
  void reinjectContentScript();
});

// ---------------------------------------------------------------------------
// TTS helper (SPEC §10.6, HD-A06/HD-07)
// ---------------------------------------------------------------------------

function speak(text: string): void {
  void speakFromSettings(text);
}


// ---------------------------------------------------------------------------
// Development-only determinism switch (compiled out of production, SPEC 17.3)
// ---------------------------------------------------------------------------

async function ignoreRealStt(): Promise<boolean> {
  if (typeof __ECHO_DEV__ === "undefined" || !__ECHO_DEV__) return false;
  const stored = await chrome.storage.session.get(QA_IGNORE_STT_KEY).catch(() => ({}));
  return (stored as Record<string, unknown>)[QA_IGNORE_STT_KEY] === true;
}

// ---------------------------------------------------------------------------
// Send message to the offscreen document
// ---------------------------------------------------------------------------

function sendToOffscreen(type: string, payload: unknown): void {
  const msg: Envelope = {
    ns: ENVELOPE_NS,
    target: "offscreen",
    type,
    reqId: crypto.randomUUID(),
    payload,
  };
  chrome.runtime.sendMessage(msg).catch(() => {
    // Offscreen doc may not be alive yet; handled by ensureOffscreen calls.
  });
}

// ---------------------------------------------------------------------------
// On-device recognition mode (SPEC §10.3)
// ---------------------------------------------------------------------------

async function getRecognitionConfig(): Promise<{ processLocally: boolean; lang: string }> {
  const lang = "en-US";
  // Check cached mode first (SPEC §10.3: do not call available() on every command).
  const stored = await chrome.storage.session.get(RECOGNITION_MODE_KEY).catch(() => ({}));
  const cached = (stored as Record<string, unknown>)[RECOGNITION_MODE_KEY];
  if (cached !== undefined) {
    return { processLocally: cached === true, lang };
  }
  // Cache miss: resolve and store. The actual SpeechRecognition.available() call
  // happens in the offscreen document; here we just default to false (cloud).
  await chrome.storage.session.set({ [RECOGNITION_MODE_KEY]: false }).catch(() => {});
  return { processLocally: false, lang };
}

// ---------------------------------------------------------------------------
// Watchdog and timeout handlers (registered with session.ts)
// ---------------------------------------------------------------------------

setOnWatchdogFired(() => {
  // 15 s elapsed since KEY_DOWN without a KEY_UP. Force-stop.
  console.warn("[ECHO SW] Watchdog fired — forcing stt.stop");
  sendToOffscreen("stt.stop", {});
  void transitionTo("TRANSCRIBING");
});

setOnTranscribingTimeout(() => {
  // 3 s in TRANSCRIBING with no final result. Use interim if any.
  void (async () => {
    const session = await getSession();
    if (session.lastInterim) {
      console.log("[ECHO SW] Transcribing timeout — promoting interim:", session.lastInterim);
      await updateTranscript(null, session.lastInterim);
      await transitionTo("RESOLVING", { finalTranscript: session.lastInterim });
      void runPipeline(session.lastInterim);
    } else {
      console.warn("[ECHO SW] Transcribing timeout — no result, entering ERROR");
      speak("Something went wrong with speech.");
      await transitionTo("IDLE");
    }
  })();
});

setOnClarifyTimeout(() => {
  // 15 s with no clarification response — discard and return to IDLE.
  void (async () => {
    console.log("[ECHO SW] Clarification timeout — returning to IDLE");
    await transitionTo("IDLE", { clarification: null });
  })();
});

// ---------------------------------------------------------------------------
// Main message handler (SPEC §5.15, §5.16)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isEnvelopeFor(message, "sw")) return undefined;

  const msg = message as Envelope<Record<string, unknown>>;

  // =========================================================================
  // key.down — SPEC §5.16, §6.1
  // =========================================================================
  if (msg.type === "key.down") {
    void (async () => {
      const session = await getSession();

      // SPEC §4.5: KEY_DOWN in any state except IDLE or CLARIFYING cancels the
      // current operation. SPEC §10.6.4: it also stops speech, always.
      const interrupting = session.state !== "IDLE" && session.state !== "CLARIFYING";
      stopTts();
      cancelPipeline();
      if (interrupting) sendToOffscreen("stt.abort", {});
      await rememberTab(_sender.tab?.id);

      // SPEC §6.2: check / obtain mic permission before starting STT.
      let micGranted = false;
      try {
        micGranted = await ensureMicPermission();
      } catch (err) {
        console.error("[ECHO SW] mic permission error", err);
      }

      if (!micGranted) {
        speak("I need microphone access to work. Click the extension icon to grant it.");
        await transitionTo("IDLE");
        sendResponse({ ok: false });
        return;
      }

      // Ensure the offscreen document is alive.
      try {
        await ensureOffscreen();
      } catch (err) {
        console.error("[ECHO SW] ensureOffscreen failed", err);
        speak("Something went wrong. Please reload the extension.");
        await transitionTo("IDLE");
        sendResponse({ ok: false });
        return;
      }

      // An interrupting KEY_DOWN still starts a fresh capture: "talking over"
      // the system means the user is speaking the next command.
      await transitionTo(
        "LISTENING",
        {
          keyDownAt: Date.now(),
          lastInterim: null,
          finalTranscript: null,
          clarification: session.state === "CLARIFYING" ? session.clarification : null,
        },
        interrupting
      );

      const config = await getRecognitionConfig();
      sendToOffscreen("stt.start", config);
      sendResponse({ ok: true });
    })();
    return true; // async response
  }

  // =========================================================================
  // key.up — SPEC §5.16, §6.1
  // =========================================================================
  if (msg.type === "key.up") {
    void (async () => {
      const session = await getSession();

      // Discard taps under 250 ms (SPEC §6.1).
      if (session.keyDownAt !== null) {
        const elapsed = Date.now() - session.keyDownAt;
        if (elapsed < HOLD_MIN_DURATION_MS) {
          console.log(`[ECHO SW] Tap discarded (${elapsed} ms < 250 ms)`);
          sendToOffscreen("stt.abort", {});
          await transitionTo("IDLE");
          sendResponse({ ok: true });
          return;
        }
      }

      // Only transition if we are in LISTENING; ignore stray key.up events.
      if (session.state === "LISTENING") {
        await transitionTo("TRANSCRIBING");
        sendToOffscreen("stt.stop", {});
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  // =========================================================================
  // stt.result — SPEC §5.16, §6.4
  // =========================================================================
  if (msg.type === "stt.result") {
    void (async () => {
      const { transcript, isFinal } = msg.payload as {
        transcript: string;
        isFinal: boolean;
        confidence: number;
      };

      if (await ignoreRealStt()) {
        console.log("[ECHO SW] real recognizer heard:", JSON.stringify(transcript), "final=" + isFinal);
        return;
      }

      const session = await getSession();
      // Only process if we're still in TRANSCRIBING (or LISTENING edge case).
      if (session.state !== "TRANSCRIBING" && session.state !== "LISTENING") return;

      if (isFinal) {
        await updateTranscript(null, transcript);
        // Release the microphone the moment the transcript is final, rather
        // than waiting for continuous=false to end the session on its own.
        // Chrome holds the mic open until then, and an open mic holds a
        // Bluetooth headset in the HFP profile (mono, ~16 kHz), so the spoken
        // answer starts playing through a hands-free channel and only clears
        // once Windows switches back to A2DP. The result is already final, so
        // there is nothing left for the recognizer to deliver.
        sendToOffscreen("stt.stop", {});
        await transitionTo("RESOLVING", { finalTranscript: transcript });
        console.log("[ECHO SW] Final transcript:", transcript);
        void runPipeline(transcript);
      } else {
        await updateTranscript(transcript, null);
      }
    })();
    return undefined;
  }

  // =========================================================================
  // stt.event — diagnostic relay of recognizer lifecycle events
  // (audiostart / speechstart / speechend). Logged only; never drives state.
  // =========================================================================
  if (msg.type === "stt.event") {
    const { name } = msg.payload as { name: string };
    console.log("[ECHO SW] stt.event", name);
    return undefined;
  }

  // =========================================================================
  // stt.error — SPEC §5.16, §10.5
  // =========================================================================
  if (msg.type === "stt.error") {
    void (async () => {
      const { code, message: errorMessage } = msg.payload as {
        code: string;
        message: string;
      };

      console.warn("[ECHO SW] stt.error", code, errorMessage);
      if (await ignoreRealStt()) return;

      // SPEC §4.5: STT_ERROR is an edge out of LISTENING / TRANSCRIBING only. An
      // error that arrives later (the recognizer's own `end` after a transcript
      // was injected or already delivered, or after a newer KEY_DOWN) is stale
      // and must not drag a running command back to IDLE.
      const session = await getSession();
      if (session.state !== "LISTENING" && session.state !== "TRANSCRIBING") return;

      switch (code) {
        case "no-speech":
        case "aborted":
          // Silent — return to IDLE. SPEC §10.5: no-speech is expected and
          // must not scold the user.
          await transitionTo("IDLE");
          break;

        case "not-allowed":
        case "service-not-allowed":
          // Reset the grant flag and trigger the permission flow again.
          await resetMicGranted();
          await transitionTo("IDLE");
          {
            const micGranted = await ensureMicPermission().catch(() => false);
            if (!micGranted) {
              speak("I need microphone access to work. Click the extension icon to grant it.");
            }
          }
          break;

        case "network":
          // SPEC §10.5: retry once with processLocally if available.
          // For now, speak the fallback string.
          speak("Speech recognition is offline.");
          await transitionTo("IDLE");
          break;

        case "language-not-supported":
          // Retry once with cloud path (SPEC §10.5).
          await chrome.storage.session.set({ [RECOGNITION_MODE_KEY]: false }).catch(() => {});
          speak("Speech recognition language issue. Switched to cloud mode.");
          await transitionTo("IDLE");
          break;

        case "audio-capture":
          speak("I can't reach the microphone.");
          await transitionTo("IDLE");
          break;

        default:
          speak("Something went wrong with speech.");
          await transitionTo("IDLE");
          break;
      }
    })();
    return undefined;
  }

  // =========================================================================
  // state.get — SPEC §5.16
  // =========================================================================
  if (msg.type === "state.get") {
    void (async () => {
      const session = await getSession();
      sendResponse({ state: session.state, clarification: session.clarification ?? null });
    })();
    return true;
  }

  // =========================================================================
  // test.transcript — SPEC §17.3 (DEV only, compiled out in production)
  // __ECHO_DEV__ is replaced by Vite's `define` at build time:
  //   production → false  (dead-code eliminated)
  //   development → true
  // Declared as a global in src/shared/speech.d.ts to satisfy TypeScript.
  // =========================================================================
  if ((typeof __ECHO_DEV__ !== "undefined" && __ECHO_DEV__) && msg.type === "test.transcript") {
    void (async () => {
      const { transcript } = msg.payload as { transcript: string };
      console.log("[ECHO SW] test.transcript injected:", transcript);
      await updateTranscript(null, transcript);
      await transitionTo("RESOLVING", { finalTranscript: transcript });
      void runPipeline(transcript);
      sendResponse({ ok: true });
    })();
    return true;
  }

  return undefined;
});

// ---------------------------------------------------------------------------
// Named exports for test access
// ---------------------------------------------------------------------------

export {
  isValidVerb,
  isValidVerbForRole,
  validateAction,
  validateExecuteRequest,
} from "./execute/validate";

export { transitionTo, getSession, resetSession } from "./session";
export { ensureMicPermission, ensureOffscreen } from "./mic";

// Expose MIC_GRANTED_KEY for test assertions.
export { MIC_GRANTED_KEY } from "../shared/constants";
