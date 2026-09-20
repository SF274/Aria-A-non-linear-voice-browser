/**
 * Spatial links — HD-12.
 *
 * A spoken answer about one control is panned to where that control is, so
 * "Search flights" arrives from the left when the button is on the left.
 *
 * SPEC 9.1 records as `[FACT]` that speech cannot be panned, and for
 * `chrome.tts` it still cannot — nothing can route its output into a Web Audio
 * graph. HD-07's ElevenLabs path returns an MP3 the content script decodes
 * itself, so it is already in a graph. These tests pin that split: the pan
 * reaches the ElevenLabs message and the local path is unaffected.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAN_CLAMP } from "../../src/shared/constants";
import { panForX } from "../../src/shared/spatial";

interface SentMessage {
  type: string;
  payload: { pan?: number; audioBase64?: string };
}

const sent: SentMessage[] = [];
let storedSettings: Record<string, unknown> = {};

beforeEach(() => {
  sent.length = 0;
  storedSettings = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: { get: vi.fn(async () => ({ settings: storedSettings })) },
      session: { get: vi.fn(async () => ({ activeTab: 1 })) },
    },
    tabs: {
      sendMessage: vi.fn(async (_tabId: number, msg: SentMessage) => {
        sent.push(msg);
        return {};
      }),
      query: vi.fn(async () => [{ id: 1 }]),
    },
    tts: { speak: vi.fn(), stop: vi.fn(), getVoices: vi.fn(async () => []) },
    runtime: { lastError: undefined },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }))
  );
  vi.stubGlobal("crypto", { randomUUID: () => "req-1" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function speakWith(
  settings: Record<string, unknown>,
  atX: number | undefined
): Promise<SentMessage | undefined> {
  storedSettings = settings;
  const { speakFromSettings } = await import("../../src/sw/tts");
  await speakFromSettings("Search flights.", undefined, atX);
  return sent.find((m) => m.type === "tts.play");
}

const ELEVENLABS = {
  useLocalTts: false,
  elevenLabsApiKey: "key-123",
  spatialLinks: true,
};

describe("SPEC 9.3's pan formula is shared, not copied", () => {
  it("is the same function the cue tones use", () => {
    expect(panForX(0.5)).toBe(0);
    expect(panForX(0)).toBe(-PAN_CLAMP);
    expect(panForX(1)).toBe(PAN_CLAMP);
  });
});

describe("a spoken answer is placed where the thing is", () => {
  it("pans left for a control on the left of the page", async () => {
    const msg = await speakWith(ELEVENLABS, 0.1);
    expect(msg?.payload.pan).toBeCloseTo(panForX(0.1));
    expect(msg?.payload.pan).toBeLessThan(0);
  });

  it("pans right for a control on the right", async () => {
    const msg = await speakWith(ELEVENLABS, 0.9);
    expect(msg?.payload.pan).toBeCloseTo(panForX(0.9));
    expect(msg?.payload.pan).toBeGreaterThan(0);
  });

  it("stays centre for a control in the middle", async () => {
    const msg = await speakWith(ELEVENLABS, 0.5);
    expect(msg?.payload.pan).toBe(0);
  });

  it("stays centre when the sentence is not about any one element", async () => {
    // A page summary, the clock, a failure sentence: no position, so no pan.
    const msg = await speakWith(ELEVENLABS, undefined);
    expect(msg?.payload.pan).toBe(0);
  });

  it("never pans hard to one ear, so the voice is never lost in one channel", async () => {
    for (const x of [0, 1]) {
      const msg = await speakWith(ELEVENLABS, x);
      expect(Math.abs(msg!.payload.pan!)).toBeLessThanOrEqual(PAN_CLAMP);
    }
  });
});

describe("the toggle", () => {
  it("speaks centre when spatialLinks is off, even with a position", async () => {
    const msg = await speakWith({ ...ELEVENLABS, spatialLinks: false }, 0.1);
    expect(msg?.payload.pan).toBe(0);
  });

  it("defaults to on when the setting has never been written", async () => {
    const msg = await speakWith(
      { useLocalTts: false, elevenLabsApiKey: "key-123" },
      0.9
    );
    expect(msg?.payload.pan).toBeGreaterThan(0);
  });
});

describe("SPEC 9.1's boundary still holds for chrome.tts", () => {
  it("sends no audio message at all on the local path, panned or not", async () => {
    const msg = await speakWith({ useLocalTts: true, spatialLinks: true }, 0.1);
    // chrome.tts speaks in the service worker; nothing is routed to a page, so
    // there is nothing to pan. The request is simply ignored, not faked.
    expect(msg).toBeUndefined();
  });
});
