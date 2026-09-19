/**
 * Offscreen document message router — SPEC §4.3, §5.15, §5.16
 *
 * This is the only entry point for the offscreen document. Its sole job is:
 *   1. Listen for chrome.runtime messages targeted at "offscreen".
 *   2. Route stt.start / stt.stop to the speech module.
 *   3. Relay stt.result / stt.error back to the service worker.
 *
 * The offscreen document owns: MediaStream, SpeechRecognition lifecycle.
 * It does NOT own: transcript interpretation, state machine, TTS.
 */

import { ENVELOPE_NS, isEnvelopeFor } from "../shared/contracts";
import type { Envelope } from "../shared/contracts";
import {
  setSendToSW,
  startRecognition,
  stopRecognition,
  abortRecognition,
} from "./speech";

// ---------------------------------------------------------------------------
// Helper: send a message to the service worker (SPEC §5.15 envelope)
// ---------------------------------------------------------------------------

function sendToSW(type: string, payload: unknown): void {
  const msg: Envelope = {
    ns: ENVELOPE_NS,
    target: "sw",
    type,
    reqId: crypto.randomUUID(),
    payload,
  };
  // The SW is the natural receiver; sendMessage with no tabId routes to the SW.
  chrome.runtime.sendMessage(msg).catch(() => {
    // SW may be restarting between events; safe to ignore.
  });
}

// Register the relay so speech.ts can forward events.
setSendToSW(sendToSW);

// ---------------------------------------------------------------------------
// Message listener (SPEC §5.15 — return early if ns/target mismatch)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    // SPEC §5.15: return early if envelope doesn't match.
    if (!isEnvelopeFor(message, "offscreen")) return undefined;

    const msg = message as Envelope<Record<string, unknown>>;

    // -----------------------------------------------------------------------
    // stt.start — SPEC §5.16 payload: { processLocally: boolean; lang: string }
    // -----------------------------------------------------------------------
    if (msg.type === "stt.start") {
      const payload = msg.payload as { processLocally?: boolean; lang?: string };
      startRecognition({
        processLocally: payload.processLocally ?? false,
        lang: payload.lang ?? "en-US",
      });
      sendResponse({ ok: true });
      return true;
    }

    // -----------------------------------------------------------------------
    // stt.stop — SPEC §5.16 payload: {}
    // stop() still delivers a final result (SPEC §10.4).
    // -----------------------------------------------------------------------
    if (msg.type === "stt.stop") {
      stopRecognition();
      sendResponse({ ok: true });
      return true;
    }

    // -----------------------------------------------------------------------
    // stt.abort — used only on KEY_DOWN interrupt (not in §5.16 catalogue but
    // implied by §10.4 "abort: only on user interrupt").
    // -----------------------------------------------------------------------
    if (msg.type === "stt.abort") {
      abortRecognition();
      sendResponse({ ok: true });
      return true;
    }

    return undefined;
  }
);
