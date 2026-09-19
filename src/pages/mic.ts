/**
 * mic.html script — IG-02 fallback (SPEC §10.2)
 *
 * When the offscreen document path fails (IG-02), the content script injects
 * this page as a hidden iframe with `allow="microphone"`. Speech recognition
 * runs here on the extension origin and relays events back to the service
 * worker via chrome.runtime.sendMessage.
 *
 * This module mirrors the offscreen/index.ts message protocol exactly:
 *   - Listens for stt.start / stt.stop from the SW (via postMessage from
 *     the content script, or direct chrome.runtime).
 *   - Sends stt.result / stt.error back to SW.
 *
 * `[REQUIREMENT]` Build this even if the offscreen path works so the fallback
 * is available without new code (SPEC §10.2 last paragraph).
 */

import { ENVELOPE_NS } from "../shared/contracts";
import type { Envelope } from "../shared/contracts";

// The SpeechRecognition constructor differs by browser.
const SpeechRecognitionCtor: typeof SpeechRecognition =
  (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition })
    .webkitSpeechRecognition ??
  (null as unknown as typeof SpeechRecognition);

let activeRecognition: SpeechRecognition | null = null;
let hasFinalResult = false;

function sendToSW(type: string, payload: unknown): void {
  const msg: Envelope = {
    ns: ENVELOPE_NS,
    target: "sw",
    type,
    reqId: crypto.randomUUID(),
    payload,
  };
  chrome.runtime.sendMessage(msg).catch(() => {
    // SW may be restarting; ignore.
  });
}

function startRecognition(processLocally: boolean, lang: string): void {
  if (!SpeechRecognitionCtor) {
    sendToSW("stt.error", { code: "service-not-allowed", message: "SpeechRecognition not available in mic iframe" });
    return;
  }

  // Always construct a new instance — reusing one across utterances produces
  // inconsistent onend behaviour (SPEC §10.4).
  if (activeRecognition) {
    activeRecognition.abort();
    activeRecognition = null;
  }

  hasFinalResult = false;
  const recognition = new SpeechRecognitionCtor();
  recognition.lang = lang;
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  // processLocally is a Chrome-specific extension; cast for safety.
  if ("processLocally" in recognition) {
    (recognition as unknown as { processLocally: boolean }).processLocally = processLocally;
  }

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript;
      const isFinal = result.isFinal;
      if (isFinal) hasFinalResult = true;
      sendToSW("stt.result", {
        transcript,
        isFinal,
        confidence: result[0].confidence ?? 1,
      });
    }
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    sendToSW("stt.error", { code: event.error, message: event.message ?? event.error });
  };

  recognition.onend = () => {
    activeRecognition = null;
    if (!hasFinalResult) {
      sendToSW("stt.error", { code: "no-speech", message: "no final result" });
    }
  };

  activeRecognition = recognition;
  recognition.start();
}

function stopRecognition(): void {
  if (activeRecognition) {
    activeRecognition.stop();
    // onend will fire and clean up activeRecognition.
  }
}

function abortRecognition(): void {
  if (activeRecognition) {
    activeRecognition.abort();
    activeRecognition = null;
  }
}

// Listen for messages from the service worker or the parent content script.
// The parent content script relays SW messages via postMessage to this iframe.
window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as Envelope | undefined;
  if (!msg || msg.ns !== ENVELOPE_NS || msg.target !== "offscreen") return;

  if (msg.type === "stt.start") {
    const payload = msg.payload as { processLocally: boolean; lang: string };
    startRecognition(payload.processLocally ?? false, payload.lang ?? "en-US");
  } else if (msg.type === "stt.stop") {
    stopRecognition();
  } else if (msg.type === "stt.abort") {
    abortRecognition();
  }
});

// Also accept direct chrome.runtime messages (if this iframe is trusted).
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as Envelope | undefined;
    if (!msg || msg.ns !== ENVELOPE_NS || msg.target !== "offscreen") return false;

    if (msg.type === "stt.start") {
      const payload = msg.payload as { processLocally: boolean; lang: string };
      startRecognition(payload.processLocally ?? false, payload.lang ?? "en-US");
    } else if (msg.type === "stt.stop") {
      stopRecognition();
    }
    return false;
  });
}
