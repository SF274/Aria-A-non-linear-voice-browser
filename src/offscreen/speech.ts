/**
 * SpeechRecognition lifecycle manager — SPEC §6.3, §10.4, §10.5
 *
 * Owns one active recognition session at a time. The service worker controls
 * start/stop via stt.start and stt.stop messages routed through
 * src/offscreen/index.ts.
 *
 * Key invariants (SPEC §10.4):
 *  - A NEW SpeechRecognition instance is constructed for every utterance.
 *    Reusing one instance produces inconsistent onend behaviour.
 *  - stop() is used on key-up so that a final result is still delivered.
 *  - abort() is used only when a new KEY_DOWN interrupts an in-flight session.
 */

import { ENVELOPE_NS } from "../shared/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SttStartConfig {
  processLocally: boolean;
  lang: string;
}

/** Callback the offscreen router uses to forward messages to the service worker. */
export type SendToSW = (type: string, payload: unknown) => void;

// ---------------------------------------------------------------------------
// Browser SpeechRecognition constructor
// ---------------------------------------------------------------------------

function getSpeechRecognitionCtor(): typeof SpeechRecognition | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (
    (w["SpeechRecognition"] as typeof SpeechRecognition | undefined) ??
    (w["webkitSpeechRecognition"] as typeof SpeechRecognition | undefined) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let activeRecognition: SpeechRecognition | null = null;
let hasFinalResult = false;
let sendFn: SendToSW | null = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function send(type: string, payload: unknown): void {
  sendFn?.(type, payload);
}

/**
 * SPEC §10.5 error handling table.
 * Some codes are "silent" — they produce a no-speech error without a spoken
 * message. The service worker, not the offscreen doc, decides what to speak.
 */
function handleRecognitionError(code: string, message: string): void {
  // All errors are forwarded; the SW applies the handling table (§10.5).
  send("stt.error", { code, message });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register the function used to relay messages back to the service worker.
 * Called once by the offscreen router during init.
 */
export function setSendToSW(fn: SendToSW): void {
  sendFn = fn;
}

/**
 * Start a new recognition session per SPEC §10.4.
 *
 * A fresh SpeechRecognition is constructed on every call. If one is already
 * active (e.g. KEY_DOWN while still transcribing), it is aborted first.
 */
export function startRecognition(config: SttStartConfig): void {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    handleRecognitionError(
      "service-not-allowed",
      "SpeechRecognition not available in this context"
    );
    return;
  }

  // Abort any in-flight session before starting a new one.
  if (activeRecognition) {
    try {
      activeRecognition.abort();
    } catch {
      // ignore
    }
    activeRecognition = null;
  }

  hasFinalResult = false;
  const recognition = new Ctor();

  // SPEC §6.3 / §10.4 configuration.
  recognition.lang = config.lang;
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  // Chrome-specific processLocally flag (SPEC §10.3).
  // Feature-detect before assigning to avoid touching unsupported engines.
  if ("processLocally" in recognition) {
    (recognition as unknown as { processLocally: boolean }).processLocally =
      config.processLocally;
  }

  // -------------------------------------------------------------------------
  // Event handlers (SPEC §6.3 steps 3–5)
  // -------------------------------------------------------------------------

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript;
      const isFinal = result.isFinal;
      if (isFinal) hasFinalResult = true;

      // SPEC §5.16 stt.result payload.
      send("stt.result", {
        transcript,
        isFinal,
        confidence: result[0].confidence ?? 1,
      });
    }
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    handleRecognitionError(event.error, event.message ?? event.error);
  };

  // SPEC §6.3 step 5: onend with no final result → stt.error { code: "no-speech" }
  recognition.onend = () => {
    activeRecognition = null;
    if (!hasFinalResult) {
      send("stt.error", {
        code: "no-speech",
        message: "recognition ended without a final result",
      });
    }
  };

  activeRecognition = recognition;
  recognition.start();
}

/**
 * Stop the active session gracefully (SPEC §10.4).
 * stop() — not abort() — so that a final result is still delivered.
 */
export function stopRecognition(): void {
  if (activeRecognition) {
    try {
      activeRecognition.stop();
    } catch {
      // ignore if already stopped
    }
    // onend fires and clears activeRecognition.
  }
}

/**
 * Abort the active session immediately. Used when KEY_DOWN interrupts a
 * session already in flight (SPEC §10.4, "abort: only on user interrupt").
 */
export function abortRecognition(): void {
  if (activeRecognition) {
    try {
      activeRecognition.abort();
    } catch {
      // ignore
    }
    activeRecognition = null;
  }
}

/** Whether a recognition session is currently active. */
export function isRecognitionActive(): boolean {
  return activeRecognition !== null;
}

// Re-export ENVELOPE_NS so callers that only import from here don't need a
// separate import of contracts.ts in the offscreen context.
export { ENVELOPE_NS };
