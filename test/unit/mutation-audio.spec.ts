/**
 * Mutation sonification — T2-01 (F-17), SPEC 9.8, extended by HD-10 (DEV-009).
 *
 * F-17's acceptance criteria are the spine of this file: five tones at 70 ms
 * spacing, at most one burst per 1200 ms however fast the page mutates, and
 * nothing at all during a scan or an execution batch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElementIndex, ElementIndexEntry } from "../../src/shared/contracts";
import {
  MUTATION_GAIN_MULTIPLIER,
  MUTATION_POINT_CAP,
  MUTATION_POINT_SPACING_MS,
  MUTATION_RATE_LIMIT_MS,
} from "../../src/shared/constants";
import {
  beginActivity,
  endActivity,
  getAudioLog,
  resetAudioEngine,
  setAudioEnabled,
} from "../../src/content/audio/engine";
import {
  type BurstInput,
  isWorthSonifying,
  selectPoints,
  sonifyBurst,
} from "../../src/content/audio/mutation";
import { type FakeAudioContext, installFakeAudioContext } from "../support/fake-audio-context";

let ctx: FakeAudioContext;

beforeEach(() => {
  resetAudioEngine();
  ctx = installFakeAudioContext(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetAudioEngine();
});

function entry(over: Partial<ElementIndexEntry> & { id: string }): ElementIndexEntry {
  return {
    role: "button",
    name: over.id,
    nameKey: over.id,
    x: 0.5,
    y: 0.5,
    enabled: true,
    visible: true,
    inViewport: true,
    value: null,
    tag: "button",
    inputType: null,
    isPassword: false,
    ...over,
  };
}

function index(entries: ElementIndexEntry[]): ElementIndex {
  return {
    buildId: "build-1",
    builtAt: Date.now(),
    url: "https://example.test/",
    title: "Test",
    viewportW: 1280,
    viewportH: 800,
    docH: 2000,
    truncated: false,
    entries,
  };
}

function burst(over: Partial<BurstInput> = {}): BurstInput {
  return {
    points: [],
    weightedAdded: 0,
    addedElements: 0,
    textChanges: 0,
    spanStart: 0.5,
    spanEnd: 0.5,
    centroidX: 0.5,
    ...over,
  };
}

function points(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    x: 0.5,
    y: 0.1 * (i + 1),
    role: "button",
  }));
}

describe("SPEC 9.8 steps 2 and 3 — which additions are sonified", () => {
  it("keeps only enabled, in-viewport additions", () => {
    const idx = index([
      entry({ id: "a" }),
      entry({ id: "b", enabled: false }),
      entry({ id: "c", inViewport: false }),
      entry({ id: "d" }),
    ]);
    const selected = selectPoints(["a", "b", "c", "d"], idx);
    expect(selected).toHaveLength(2);
  });

  it("ignores entries that were already there", () => {
    const idx = index([entry({ id: "a" }), entry({ id: "b" })]);
    expect(selectPoints(["b"], idx)).toHaveLength(1);
  });

  it("sorts by y then x, so a burst describes a shape and not a list", () => {
    const idx = index([
      entry({ id: "bottom-left", x: 0.1, y: 0.9 }),
      entry({ id: "top-right", x: 0.9, y: 0.1 }),
      entry({ id: "top-left", x: 0.1, y: 0.1 }),
    ]);
    const selected = selectPoints(["bottom-left", "top-right", "top-left"], idx);
    expect(selected.map((p) => [p.x, p.y])).toEqual([
      [0.1, 0.1],
      [0.9, 0.1],
      [0.1, 0.9],
    ]);
  });

  it("caps at 8 points", () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      entry({ id: `e${i}`, y: i / 20 })
    );
    const selected = selectPoints(
      entries.map((e) => e.id),
      index(entries)
    );
    expect(selected).toHaveLength(MUTATION_POINT_CAP);
    // The cap keeps the top of the page, not an arbitrary eight.
    expect(selected[0].y).toBeCloseTo(0);
  });
});

describe("F-17 — five results produce five tones at 70 ms spacing", () => {
  it("schedules one point tone per addition, 70 ms apart, all up front", () => {
    const outcome = sonifyBurst(
      burst({ points: points(5), weightedAdded: 35, addedElements: 5 }),
      { lastBurstAt: 0 },
      5000
    );
    expect(outcome).toBe("played");

    const tones = getAudioLog().filter((c) => c.layer === "point");
    expect(tones).toHaveLength(5);
    for (let i = 1; i < tones.length; i++) {
      expect((tones[i].when - tones[i - 1].when) * 1000).toBeCloseTo(
        MUTATION_POINT_SPACING_MS,
        6
      );
    }
    // Scheduled against the context clock, not the wall clock.
    expect(tones[0].when).toBe(ctx.currentTime);
  });

  it("plays them quieter than a scan — this is ambient, not focal (step 4)", () => {
    sonifyBurst(burst({ points: points(3), addedElements: 3 }), { lastBurstAt: 0 }, 5000);
    const tones = getAudioLog().filter((c) => c.layer === "point");
    // A control's peak is 0.18 under SPEC 9.3.
    for (const tone of tones) {
      expect(tone.peakGain).toBeCloseTo(0.18 * MUTATION_GAIN_MULTIPLIER);
    }
  });

  it("still fires when the additions are all out of view — the swell carries it", () => {
    const outcome = sonifyBurst(
      burst({ points: [], weightedAdded: 30, addedElements: 5 }),
      { lastBurstAt: 0 },
      5000
    );
    expect(outcome).toBe("played");
    expect(getAudioLog().filter((c) => c.layer === "swell")).toHaveLength(1);
  });
});

describe("F-17 — at most one burst per 1200 ms (SPEC 9.8 step 6)", () => {
  it("drops a second burst inside the window and admits the next one after it", () => {
    const state = { lastBurstAt: 0 };
    expect(sonifyBurst(burst({ points: points(3), addedElements: 3 }), state, 10_000)).toBe(
      "played"
    );
    expect(sonifyBurst(burst({ points: points(3), addedElements: 3 }), state, 10_100)).toBe(
      "rate-limited"
    );
    expect(
      sonifyBurst(burst({ points: points(3), addedElements: 3 }), state, 10_000 + MUTATION_RATE_LIMIT_MS)
    ).toBe("played");
  });

  it("a page mutating 20 times a second produces one burst per 1200 ms, not 20", () => {
    const state = { lastBurstAt: 0 };
    let played = 0;
    // Three seconds at 20 Hz.
    for (let i = 0; i < 60; i++) {
      const now = 1000 + i * 50;
      if (sonifyBurst(burst({ points: points(2), addedElements: 2 }), state, now) === "played") {
        played++;
      }
    }
    expect(played).toBe(3);
  });

  it("does not spend the rate limit on a burst that made no sound", () => {
    const state = { lastBurstAt: 0 };
    // Too small to be worth a sound...
    expect(sonifyBurst(burst({ addedElements: 1 }), state, 10_000)).toBe("below-threshold");
    // ...so the real event 100 ms later is still heard.
    expect(sonifyBurst(burst({ points: points(5), addedElements: 5 }), state, 10_100)).toBe(
      "played"
    );
  });
});

describe("F-17 — nothing fires during a scan or an execution batch (step 5)", () => {
  it("is silent while a scan plays", () => {
    beginActivity("scan");
    expect(sonifyBurst(burst({ points: points(5), addedElements: 5 }), { lastBurstAt: 0 }, 10_000)).toBe(
      "suppressed-activity"
    );
    expect(getAudioLog()).toHaveLength(0);
    endActivity("scan");
  });

  it("is silent while an execution batch runs", () => {
    beginActivity("batch");
    expect(sonifyBurst(burst({ points: points(5), addedElements: 5 }), { lastBurstAt: 0 }, 10_000)).toBe(
      "suppressed-activity"
    );
    expect(getAudioLog()).toHaveLength(0);
    endActivity("batch");
  });

  it("does not spend the rate limit on a burst it suppressed", () => {
    const state = { lastBurstAt: 0 };
    beginActivity("batch");
    sonifyBurst(burst({ points: points(5), addedElements: 5 }), state, 10_000);
    endActivity("batch");
    expect(sonifyBurst(burst({ points: points(5), addedElements: 5 }), state, 10_050)).toBe(
      "played"
    );
  });
});

describe("the minimum-magnitude gate (HD-10)", () => {
  it("ignores a single element swapping in, which is what a spinner is", () => {
    expect(isWorthSonifying({ points: [], addedElements: 1, textChanges: 0 })).toBe(false);
    expect(isWorthSonifying({ points: [], addedElements: 0, textChanges: 1 })).toBe(false);
  });

  it("never ignores a change that added something the user can act on", () => {
    expect(isWorthSonifying({ points: points(1), addedElements: 1, textChanges: 0 })).toBe(true);
  });

  it("takes real structural or textual change", () => {
    expect(isWorthSonifying({ points: [], addedElements: 2, textChanges: 0 })).toBe(true);
    expect(isWorthSonifying({ points: [], addedElements: 0, textChanges: 2 })).toBe(true);
  });
});

describe("the three layers (HD-10)", () => {
  it("adds a swell only when enough arrived to have a body", () => {
    sonifyBurst(burst({ points: points(2), weightedAdded: 2, addedElements: 2 }), { lastBurstAt: 0 }, 10_000);
    expect(getAudioLog().filter((c) => c.layer === "swell")).toHaveLength(0);

    resetAudioEngine();
    installFakeAudioContext(vi.stubGlobal);
    sonifyBurst(burst({ points: points(2), weightedAdded: 40, addedElements: 6 }), { lastBurstAt: 0 }, 10_000);
    expect(getAudioLog().filter((c) => c.layer === "swell")).toHaveLength(1);
  });

  it("pans the swell to where the change landed", () => {
    sonifyBurst(
      burst({ weightedAdded: 40, addedElements: 6, centroidX: 0.1, spanStart: 0.05, spanEnd: 0.15 }),
      { lastBurstAt: 0 },
      10_000
    );
    const swell = getAudioLog().find((c) => c.layer === "swell")!;
    // Left of centre, because the change happened on the left.
    expect(swell.pan).toBeLessThan(-0.5);
  });

  it("plays churn ticks when text changed but nothing interactive arrived", () => {
    sonifyBurst(burst({ textChanges: 4, spanStart: 0.2, spanEnd: 0.8 }), { lastBurstAt: 0 }, 10_000);
    const ticks = getAudioLog().filter((c) => c.layer === "churn");
    expect(ticks).toHaveLength(4);
    // Spread across the stereo field rather than stacked in one place.
    expect(new Set(ticks.map((t) => t.pan)).size).toBe(4);
  });

  it("caps a churn flurry however much text changed", () => {
    sonifyBurst(burst({ textChanges: 500 }), { lastBurstAt: 0 }, 10_000);
    expect(getAudioLog().filter((c) => c.layer === "churn")).toHaveLength(5);
  });

  it("drops the churn layer when there are points — they already say it", () => {
    sonifyBurst(
      burst({ points: points(3), addedElements: 3, textChanges: 20 }),
      { lastBurstAt: 0 },
      10_000
    );
    expect(getAudioLog().filter((c) => c.layer === "churn")).toHaveLength(0);
    expect(getAudioLog().filter((c) => c.layer === "point")).toHaveLength(3);
  });
});

describe("SPEC 9.6 and 5.13 — silence is always an acceptable outcome", () => {
  it("reports no-audio rather than throwing when the context is unusable", () => {
    vi.unstubAllGlobals();
    resetAudioEngine();
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("no audio device");
        }
      }
    );
    expect(sonifyBurst(burst({ points: points(5), addedElements: 5 }), { lastBurstAt: 0 }, 10_000)).toBe(
      "no-audio"
    );
  });

  it("schedules nothing when settings.audioEnabled is false", () => {
    setAudioEnabled(false);
    sonifyBurst(burst({ points: points(5), weightedAdded: 40, addedElements: 5 }), { lastBurstAt: 0 }, 10_000);
    expect(ctx.oscillators).toHaveLength(0);
  });
});
