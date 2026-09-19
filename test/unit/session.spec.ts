/**
 * Session state machine unit tests — SPEC §4.5, §6.1, §6.4
 *
 * Tests the transition logic, timer arming, and persistence behaviour.
 * chrome.storage.session is mocked via vi.stubGlobal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock chrome.storage.session and chrome.storage.local
// ---------------------------------------------------------------------------

const storageMock: Record<string, unknown> = {};

const chromeMock = {
  storage: {
    session: {
      get: vi.fn(async (key: string) => ({ [key]: storageMock[key] })),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        Object.assign(storageMock, obj);
      }),
    },
    local: {
      get: vi.fn(async (key: string) => ({ [key]: storageMock[key] })),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        Object.assign(storageMock, obj);
      }),
    },
  },
  tts: {
    stop: vi.fn(),
    speak: vi.fn(),
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({}),
  },
  tabs: {},
  offscreen: null,
};

vi.stubGlobal("chrome", chromeMock);

// ---------------------------------------------------------------------------
// Import after mocking
// ---------------------------------------------------------------------------

import {
  transitionTo,
  getSession,
  resetSession,
  setOnWatchdogFired,
  setOnTranscribingTimeout,
  setOnClarifyTimeout,
  onTransition,
} from "../../src/sw/session";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Session state machine (SPEC §4.5)", () => {
  beforeEach(async () => {
    // Clear storage and reset session before each test.
    for (const key of Object.keys(storageMock)) {
      delete storageMock[key];
    }
    vi.useFakeTimers();
    await resetSession();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Basic transitions
  // -------------------------------------------------------------------------

  it("starts in IDLE state", async () => {
    const session = await getSession();
    expect(session.state).toBe("IDLE");
  });

  it("IDLE → LISTENING on key.down", async () => {
    const session = await transitionTo("LISTENING", { keyDownAt: Date.now() });
    expect(session.state).toBe("LISTENING");
  });

  it("LISTENING → TRANSCRIBING on key.up", async () => {
    await transitionTo("LISTENING", { keyDownAt: Date.now() });
    const session = await transitionTo("TRANSCRIBING");
    expect(session.state).toBe("TRANSCRIBING");
  });

  it("TRANSCRIBING → RESOLVING on final transcript", async () => {
    await transitionTo("LISTENING");
    await transitionTo("TRANSCRIBING");
    const session = await transitionTo("RESOLVING", {
      finalTranscript: "click search flights",
    });
    expect(session.state).toBe("RESOLVING");
    expect(session.finalTranscript).toBe("click search flights");
  });

  it("transitions to IDLE via resetSession()", async () => {
    await transitionTo("LISTENING");
    await resetSession();
    const session = await getSession();
    expect(session.state).toBe("IDLE");
    expect(session.lastInterim).toBeNull();
    expect(session.finalTranscript).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Interrupt rule (SPEC §4.5)
  // -------------------------------------------------------------------------

  it("KEY_DOWN in TRANSCRIBING cancels and moves to LISTENING (force=true)", async () => {
    await transitionTo("LISTENING");
    await transitionTo("TRANSCRIBING");
    const session = await transitionTo("LISTENING", { keyDownAt: Date.now() }, true);
    expect(session.state).toBe("LISTENING");
  });

  it("KEY_DOWN in RESOLVING cancels and moves to LISTENING (force=true)", async () => {
    await transitionTo("LISTENING");
    await transitionTo("TRANSCRIBING");
    await transitionTo("RESOLVING");
    const session = await transitionTo("LISTENING", { keyDownAt: Date.now() }, true);
    expect(session.state).toBe("LISTENING");
  });

  // -------------------------------------------------------------------------
  // Watchdog timer (SPEC §6.1: 15 s)
  // -------------------------------------------------------------------------

  it("fires the watchdog callback after WATCHDOG_TIMEOUT_MS", async () => {
    const watchdogFired = vi.fn();
    setOnWatchdogFired(watchdogFired);

    await transitionTo("LISTENING");
    expect(watchdogFired).not.toHaveBeenCalled();

    // Advance past watchdog.
    vi.advanceTimersByTime(15_001);
    expect(watchdogFired).toHaveBeenCalledOnce();
  });

  it("clears the watchdog timer on transition out of LISTENING", async () => {
    const watchdogFired = vi.fn();
    setOnWatchdogFired(watchdogFired);

    await transitionTo("LISTENING");
    await transitionTo("TRANSCRIBING");

    vi.advanceTimersByTime(15_001);
    // Watchdog should have been cleared, not fired.
    expect(watchdogFired).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Transcribing timeout (SPEC §6.4: 3000 ms)
  // -------------------------------------------------------------------------

  it("fires the transcribing timeout after TRANSCRIBING_TIMEOUT_MS", async () => {
    const timeoutFired = vi.fn();
    setOnTranscribingTimeout(timeoutFired);

    await transitionTo("LISTENING");
    await transitionTo("TRANSCRIBING");

    vi.advanceTimersByTime(3_001);
    expect(timeoutFired).toHaveBeenCalledOnce();
  });

  it("clears the transcribing timer on transition out of TRANSCRIBING", async () => {
    const timeoutFired = vi.fn();
    setOnTranscribingTimeout(timeoutFired);

    await transitionTo("LISTENING");
    await transitionTo("TRANSCRIBING");
    await transitionTo("RESOLVING");

    vi.advanceTimersByTime(3_001);
    expect(timeoutFired).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Clarification timeout (SPEC §5.9: 15 s)
  // -------------------------------------------------------------------------

  it("fires the clarification timeout after CLARIFY_TIMEOUT_MS", async () => {
    const clarifyTimeout = vi.fn();
    setOnClarifyTimeout(clarifyTimeout);

    await transitionTo("CLARIFYING");

    vi.advanceTimersByTime(15_001);
    expect(clarifyTimeout).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Transition callbacks
  // -------------------------------------------------------------------------

  it("calls registered onTransition callbacks", async () => {
    const cb = vi.fn();
    onTransition(cb);

    await transitionTo("LISTENING");
    expect(cb).toHaveBeenCalledWith("IDLE", "LISTENING", expect.objectContaining({ state: "LISTENING" }));
  });

  // -------------------------------------------------------------------------
  // Persistence (stored in chrome.storage.session)
  // -------------------------------------------------------------------------

  it("persists state to storage.session on every transition", async () => {
    await transitionTo("LISTENING", { keyDownAt: 12345 });
    expect(chromeMock.storage.session.set).toHaveBeenCalled();
    const lastCall = chromeMock.storage.session.set.mock.calls.slice(-1)[0][0] as Record<string, unknown>;
    const saved = lastCall["session"] as { state: string };
    expect(saved.state).toBe("LISTENING");
  });

  it("loads persisted state from storage on getSession()", async () => {
    // Simulate a stored state from a previous SW instance.
    storageMock["session"] = {
      state: "TRANSCRIBING",
      lastInterim: "hello",
      finalTranscript: null,
      clarification: null,
      keyDownAt: null,
    };
    const session = await getSession();
    expect(session.state).toBe("TRANSCRIBING");
    expect(session.lastInterim).toBe("hello");
  });
});
