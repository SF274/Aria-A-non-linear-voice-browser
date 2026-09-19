/**
 * Execution ticks — the SPEC 9.3 mappings behind the positional tick the
 * executor plays per step of a sequence (7.6.3 step 5), and the rule that audio
 * trouble never breaks anything (9.6).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  freqForY,
  panForX,
  playPositionalTick,
  playProcessingTick,
  timbreForRole,
} from "../../src/content/audio-stubs";

describe("SPEC 9.3 spatial mapping", () => {
  it("pan(x) = clamp(2x - 1, -0.95, 0.95)", () => {
    expect(panForX(0.5)).toBe(0);
    expect(panForX(0.75)).toBeCloseTo(0.5);
    expect(panForX(0)).toBe(-0.95);
    expect(panForX(1)).toBe(0.95);
  });

  it("freq(y) spans two octaves: y=1 -> 220 Hz, y=0 -> 880 Hz", () => {
    expect(freqForY(1)).toBeCloseTo(220);
    expect(freqForY(0.5)).toBeCloseTo(440);
    expect(freqForY(0)).toBeCloseTo(880);
  });

  it("timbre by role class", () => {
    expect(timbreForRole("link")).toEqual({ type: "sine", peak: 0.16, lowpass: false });
    expect(timbreForRole("button")).toEqual({ type: "triangle", peak: 0.18, lowpass: false });
    expect(timbreForRole("textbox")).toEqual({ type: "square", peak: 0.14, lowpass: true });
    const other = timbreForRole("heading");
    expect(other.type).toBe("sine");
    expect(other.peak).toBeCloseTo(0.16 * 0.7);
  });
});

describe("ticks degrade to silence (SPEC 9.6)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never throw when an AudioContext cannot be constructed", async () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("no audio device");
        }
      }
    );
    await expect(playPositionalTick({ x: 0.2, y: 0.8, role: "button" })).resolves.toBeUndefined();
    await expect(playProcessingTick()).resolves.toBeUndefined();
  });
});
