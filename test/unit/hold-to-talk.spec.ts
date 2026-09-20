/**
 * Hold-to-talk unit tests — SPEC §6.1
 *
 * Tests key capture, editable-target guard, and message dispatch.
 * The chrome.runtime API and the audio modules are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock chrome.runtime.sendMessage
// ---------------------------------------------------------------------------

const sentMessages: unknown[] = [];

vi.stubGlobal("chrome", {
  runtime: {
    sendMessage: vi.fn(async (msg: unknown) => {
      sentMessages.push(msg);
      return {};
    }),
  },
  storage: {
    local: {
      get: vi.fn(async () => ({})),
    },
    onChanged: {
      addListener: vi.fn(),
    },
  },
});

// ---------------------------------------------------------------------------
// Mock the audio engine and transport so tones need no real AudioContext
// ---------------------------------------------------------------------------

vi.mock("../../src/content/audio/engine", () => ({
  resumeAudioContext: vi.fn().mockResolvedValue(undefined),
  isAudioAvailable: vi.fn().mockReturnValue(true),
}));

vi.mock("../../src/content/audio/transport", () => ({
  playListenStart: vi.fn().mockResolvedValue(undefined),
  playListenEnd: vi.fn().mockResolvedValue(undefined),
  playError: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Import after mocking
// ---------------------------------------------------------------------------

import {
  initHoldToTalk,
  destroyHoldToTalk,
  getHoldKey,
  handleStorageChange,
  loadSettings,
  setHoldKey,
} from "../../src/content/hold-to-talk";
import { playListenStart, playListenEnd } from "../../src/content/audio/transport";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fireKeydown(code: string, target?: Element): void {
  const event = new KeyboardEvent("keydown", {
    code,
    bubbles: true,
    cancelable: true,
  });
  if (target) {
    // Dispatch on the element itself so capture-phase listeners on window
    // see the correct event.target during bubble propagation.
    target.dispatchEvent(event);
  } else {
    window.dispatchEvent(event);
  }
}

function fireKeyup(code: string, target?: Element): void {
  const event = new KeyboardEvent("keyup", {
    code,
    bubbles: true,
    cancelable: true,
  });
  if (target) {
    target.dispatchEvent(event);
  } else {
    window.dispatchEvent(event);
  }
}

function getMessages(type: string): unknown[] {
  return sentMessages.filter(
    (m) => typeof m === "object" && m !== null && (m as { type?: string }).type === type
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Hold-to-talk key capture (SPEC §6.1)", () => {
  beforeEach(() => {
    sentMessages.length = 0;
    vi.clearAllMocks();
    setHoldKey("Space");
    initHoldToTalk();
  });

  afterEach(() => {
    destroyHoldToTalk();
  });

  // -------------------------------------------------------------------------
  // Basic dispatch
  // -------------------------------------------------------------------------

  it("sends key.down on Space keydown (target = body)", async () => {
    fireKeydown("Space");
    // Allow microtasks to flush.
    await Promise.resolve();
    const keyDownMsgs = getMessages("key.down");
    expect(keyDownMsgs.length).toBeGreaterThanOrEqual(1);
    const msg = keyDownMsgs[0] as { ns: string; target: string; type: string };
    expect(msg.ns).toBe("echo");
    expect(msg.target).toBe("sw");
    expect(msg.type).toBe("key.down");
  });

  it("sends key.up on Space keyup", async () => {
    fireKeydown("Space");
    fireKeyup("Space");
    await Promise.resolve();
    const keyUpMsgs = getMessages("key.up");
    expect(keyUpMsgs.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Editable target guard (SPEC §6.1)
  // -------------------------------------------------------------------------

  it("does NOT intercept Space keydown inside <input>", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireKeydown("Space", input);
    await Promise.resolve();
    const keyDownMsgs = getMessages("key.down");
    expect(keyDownMsgs.length).toBe(0);
    document.body.removeChild(input);
  });

  it("does NOT intercept Space keydown inside <textarea>", async () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    fireKeydown("Space", ta);
    await Promise.resolve();
    expect(getMessages("key.down").length).toBe(0);
    document.body.removeChild(ta);
  });

  it("does NOT intercept Space keydown inside contenteditable", async () => {
    const div = document.createElement("div");
    div.contentEditable = "true";
    document.body.appendChild(div);
    fireKeydown("Space", div);
    await Promise.resolve();
    expect(getMessages("key.down").length).toBe(0);
    document.body.removeChild(div);
  });

  it("does NOT intercept Space keyup inside <input>", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKeyup("Space", input);
    await Promise.resolve();
    expect(getMessages("key.up").length).toBe(0);
    document.body.removeChild(input);
  });

  // -------------------------------------------------------------------------
  // Non-matching keys
  // -------------------------------------------------------------------------

  it("does not intercept other keys", async () => {
    fireKeydown("KeyA");
    fireKeyup("KeyA");
    await Promise.resolve();
    expect(getMessages("key.down").length).toBe(0);
    expect(getMessages("key.up").length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Audio calls
  // -------------------------------------------------------------------------

  it("calls playListenStart on keydown", async () => {
    fireKeydown("Space");
    // Give async tone a moment.
    await new Promise((r) => setTimeout(r, 0));
    expect(playListenStart).toHaveBeenCalled();
  });

  it("calls playListenEnd on keyup", async () => {
    fireKeydown("Space");
    fireKeyup("Space");
    await new Promise((r) => setTimeout(r, 0));
    expect(playListenEnd).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Custom hold key
  // -------------------------------------------------------------------------

  it("respects a custom hold key", async () => {
    setHoldKey("KeyF");
    fireKeydown("KeyF");
    await Promise.resolve();
    expect(getMessages("key.down").length).toBeGreaterThanOrEqual(1);

    // Space should now be ignored.
    sentMessages.length = 0;
    fireKeydown("Space");
    await Promise.resolve();
    expect(getMessages("key.down").length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // reqId uniqueness
  // -------------------------------------------------------------------------

  it("generates a unique reqId for each message", async () => {
    fireKeydown("Space");
    fireKeyup("Space");
    await Promise.resolve();
    const ids = sentMessages.map((m) => (m as { reqId?: string }).reqId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Where the hold key lives in storage (SPEC 5.13): the options page saves the
// whole Settings object under `settings`, so the key is `settings.holdKey`.
// ---------------------------------------------------------------------------

describe("Hold key comes from settings.holdKey", () => {
  const get = (): ReturnType<typeof vi.fn> =>
    (chrome as unknown as { storage: { local: { get: ReturnType<typeof vi.fn> } } }).storage.local.get;

  beforeEach(() => {
    setHoldKey("Space");
  });

  it("loads settings.holdKey on init", async () => {
    get().mockResolvedValueOnce({ settings: { holdKey: "KeyF", verbosity: "fast" } });
    await loadSettings();
    expect(getHoldKey()).toBe("KeyF");
    expect(get()).toHaveBeenLastCalledWith("settings");
  });

  it("ignores a top-level holdKey entry (the old, wrong location)", async () => {
    get().mockResolvedValueOnce({ holdKey: "KeyF" });
    await loadSettings();
    expect(getHoldKey()).toBe("Space");
  });

  it("keeps the default when settings are missing, partial, or hold a bad value", async () => {
    for (const stored of [{}, { settings: {} }, { settings: { holdKey: "" } }, { settings: { holdKey: 7 } }, { settings: null }]) {
      get().mockResolvedValueOnce(stored);
      await loadSettings();
      expect(getHoldKey()).toBe("Space");
    }
  });

  it("keeps the default when storage throws", async () => {
    get().mockRejectedValueOnce(new Error("storage unavailable"));
    await loadSettings();
    expect(getHoldKey()).toBe("Space");
  });

  it("follows a settings change made on the options page", () => {
    handleStorageChange({ settings: { newValue: { holdKey: "KeyG" } } }, "local");
    expect(getHoldKey()).toBe("KeyG");
  });

  it("ignores unrelated or session-area changes and a top-level holdKey change", () => {
    handleStorageChange({ settings: { newValue: { holdKey: "KeyG" } } }, "session");
    handleStorageChange({ holdKey: { newValue: "KeyG" } }, "local");
    handleStorageChange({ settings: { newValue: { verbosity: "verbose" } } }, "local");
    expect(getHoldKey()).toBe("Space");
  });

  it("a key loaded from settings is the one that triggers key.down", async () => {
    get().mockResolvedValueOnce({ settings: { holdKey: "KeyF" } });
    initHoldToTalk();
    try {
      await loadSettings();
      sentMessages.length = 0;
      fireKeydown("KeyF");
      await Promise.resolve();
      expect(getMessages("key.down").length).toBe(1);
      sentMessages.length = 0;
      fireKeydown("Space");
      await Promise.resolve();
      expect(getMessages("key.down").length).toBe(0);
    } finally {
      destroyHoldToTalk();
    }
  });
});
