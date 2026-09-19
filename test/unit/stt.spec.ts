/**
 * Speech recognition lifecycle unit tests — SPEC §6.3, §10.4, §10.5
 *
 * Uses a hand-rolled SpeechRecognition mock that mirrors the browser interface.
 * The mock lets tests fire onresult, onerror, onend events programmatically.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock SpeechRecognition
// ---------------------------------------------------------------------------

interface MockRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  // Test helpers
  _fireResult(transcript: string, isFinal: boolean, confidence?: number): void;
  _fireError(code: string, message?: string): void;
  _fireEnd(): void;
}

const recognitionInstances: MockRecognitionInstance[] = [];

class MockSpeechRecognition implements MockRecognitionInstance {
  lang = "en-US";
  interimResults = false;
  continuous = false;
  maxAlternatives = 1;
  processLocally?: boolean;
  onresult: ((e: SpeechRecognitionEvent) => void) | null = null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    recognitionInstances.push(this);
  }

  _fireResult(transcript: string, isFinal: boolean, confidence = 1): void {
    const alt: SpeechRecognitionAlternative = {
      transcript,
      confidence,
    } as SpeechRecognitionAlternative;

    // Build a minimal SpeechRecognitionResultList-like object.
    const result = {
      0: alt,
      isFinal,
      length: 1,
      item: (_i: number) => alt,
      [Symbol.iterator]: function* () { yield result; },
    } as unknown as SpeechRecognitionResult;

    const resultList = {
      0: result,
      length: 1,
      item: (_i: number) => result,
      [Symbol.iterator]: function* () { yield result; },
    } as unknown as SpeechRecognitionResultList;

    const event = {
      resultIndex: 0,
      results: resultList,
    } as unknown as SpeechRecognitionEvent;

    this.onresult?.(event);
  }

  _fireError(code: string, message = code): void {
    const event = { error: code, message } as SpeechRecognitionErrorEvent;
    this.onerror?.(event);
  }

  _fireEnd(): void {
    this.onend?.();
  }
}

vi.stubGlobal("SpeechRecognition", MockSpeechRecognition);

// ---------------------------------------------------------------------------
// Capture messages sent to the SW
// ---------------------------------------------------------------------------

const swMessages: Array<{ type: string; payload: unknown }> = [];

vi.stubGlobal("chrome", {
  runtime: {
    sendMessage: vi.fn(async (msg: { type: string; payload: unknown }) => {
      swMessages.push({ type: msg.type, payload: msg.payload });
    }),
  },
});

// ---------------------------------------------------------------------------
// Import after mocking
// ---------------------------------------------------------------------------

import {
  startRecognition,
  stopRecognition,
  abortRecognition,
  isRecognitionActive,
  setSendToSW,
} from "../../src/offscreen/speech";

// Wire up the relay used by speech.ts.
setSendToSW((type, payload) => {
  swMessages.push({ type, payload });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lastInstance(): MockRecognitionInstance {
  return recognitionInstances[recognitionInstances.length - 1];
}

function getSwMessages(type: string) {
  return swMessages.filter((m) => m.type === type);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SpeechRecognition lifecycle (SPEC §6.3, §10.4, §10.5)", () => {
  beforeEach(() => {
    recognitionInstances.length = 0;
    swMessages.length = 0;
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Configuration (SPEC §6.3 step 1)
  // -------------------------------------------------------------------------

  it("constructs a new SpeechRecognition instance on each startRecognition call", () => {
    startRecognition({ processLocally: false, lang: "en-US" });
    startRecognition({ processLocally: false, lang: "en-US" });
    // Two calls → two instances (plus the first aborts the previous).
    expect(recognitionInstances.length).toBe(2);
  });

  it("sets lang, interimResults, continuous, maxAlternatives per spec", () => {
    startRecognition({ processLocally: false, lang: "en-US" });
    const inst = lastInstance();
    expect(inst.lang).toBe("en-US");
    expect(inst.interimResults).toBe(true);
    expect(inst.continuous).toBe(false);
    expect(inst.maxAlternatives).toBe(1);
  });

  it("sets processLocally when the flag is present on the instance", () => {
    startRecognition({ processLocally: true, lang: "en-US" });
    const inst = lastInstance();
    expect(inst.processLocally).toBe(true);
  });

  it("calls recognition.start()", () => {
    startRecognition({ processLocally: false, lang: "en-US" });
    expect(lastInstance().start).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // onresult — interim and final (SPEC §6.3 step 3)
  // -------------------------------------------------------------------------

  it("posts stt.result with isFinal=false for interim results", () => {
    startRecognition({ processLocally: false, lang: "en-US" });
    lastInstance()._fireResult("hello ", false, 0.9);
    const msgs = getSwMessages("stt.result");
    expect(msgs.length).toBe(1);
    expect((msgs[0].payload as { isFinal: boolean }).isFinal).toBe(false);
    expect((msgs[0].payload as { transcript: string }).transcript).toBe("hello ");
  });

  it("posts stt.result with isFinal=true for final results", () => {
    startRecognition({ processLocally: false, lang: "en-US" });
    lastInstance()._fireResult("click search", true, 0.98);
    const msgs = getSwMessages("stt.result");
    expect(msgs.length).toBe(1);
    expect((msgs[0].payload as { isFinal: boolean }).isFinal).toBe(true);
  });

  it("includes confidence in stt.result payload", () => {
    startRecognition({ processLocally: false, lang: "en-US" });
    lastInstance()._fireResult("test", true, 0.95);
    const msg = getSwMessages("stt.result")[0];
    expect((msg.payload as { confidence: number }).confidence).toBe(0.95);
  });

  // -------------------------------------------------------------------------
  // onerror — SPEC §6.3 step 4, §10.5
  // -------------------------------------------------------------------------

  it("posts stt.error with code from onerror event", () => {
    startRecognition({ processLocally: false, lang: "en-US" });
    lastInstance()._fireError("not-allowed");
    const msgs = getSwMessages("stt.error");
    expect(msgs.length).toBe(1);
    expect((msgs[0].payload as { code: string }).code).toBe("not-allowed");
  });

  it("posts stt.error for no-speech code", () => {
    startRecognition({ processLocally: false, lang: "en-US" });
    lastInstance()._fireError("no-speech");
    expect(getSwMessages("stt.error").length).toBe(1);
    expect((getSwMessages("stt.error")[0].payload as { code: string }).code).toBe("no-speech");
  });

  it("posts stt.error for audio-capture code", () => {
    startRecognition({ processLocally: false, lang: "en-US" });
    lastInstance()._fireError("audio-capture");
    expect((getSwMessages("stt.error")[0].payload as { code: string }).code).toBe("audio-capture");
  });

  it("posts stt.error for network code", () => {
    startRecognition({ processLocally: false, lang: "en-US" });
    lastInstance()._fireError("network");
    expect((getSwMessages("stt.error")[0].payload as { code: string }).code).toBe("network");
  });

  // -------------------------------------------------------------------------
  // onend without final result → no-speech (SPEC §6.3 step 5)
  // -------------------------------------------------------------------------

  it("posts stt.error { code: 'no-speech' } when onend fires without a final result", () => {
    startRecognition({ processLocally: false, lang: "en-US" });
    lastInstance()._fireEnd(); // no _fireResult beforehand
    const errMsgs = getSwMessages("stt.error");
    expect(errMsgs.length).toBe(1);
    expect((errMsgs[0].payload as { code: string }).code).toBe("no-speech");
  });

  it("does NOT post no-speech error when onend fires after a final result", () => {
    startRecognition({ processLocally: false, lang: "en-US" });
    lastInstance()._fireResult("done", true);
    lastInstance()._fireEnd();
    // stt.result should exist; no extra stt.error.
    expect(getSwMessages("stt.error").length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // stopRecognition
  // -------------------------------------------------------------------------

  it("calls recognition.stop() on stopRecognition()", () => {
    startRecognition({ processLocally: false, lang: "en-US" });
    stopRecognition();
    expect(lastInstance().stop).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // abortRecognition
  // -------------------------------------------------------------------------

  it("calls recognition.abort() on abortRecognition()", () => {
    startRecognition({ processLocally: false, lang: "en-US" });
    abortRecognition();
    expect(recognitionInstances[0].abort).toHaveBeenCalledOnce();
  });

  it("isRecognitionActive() reflects active state", () => {
    startRecognition({ processLocally: false, lang: "en-US" });
    expect(isRecognitionActive()).toBe(true);
    abortRecognition();
    expect(isRecognitionActive()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // New instance per utterance (SPEC §10.4)
  // -------------------------------------------------------------------------

  it("aborts the previous instance when startRecognition is called while active", () => {
    startRecognition({ processLocally: false, lang: "en-US" });
    const first = recognitionInstances[0];
    startRecognition({ processLocally: false, lang: "en-US" });
    expect(first.abort).toHaveBeenCalledOnce();
  });
});
