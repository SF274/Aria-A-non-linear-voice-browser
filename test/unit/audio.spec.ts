/**
 * Audio engine — T1-02 (F-10), SPEC 9.3, 9.5, 9.6.
 *
 * The test TASKS.md names for this task: pan monotonic in x, frequency
 * monotonically decreasing in y, the right oscillator per role class, and the
 * exponential-ramp-to-0.0001 rule — all against a mock `AudioContext`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GAIN_FLOOR,
  INPUT_FILTER_FREQ_MULTIPLIER,
  INPUT_FILTER_Q,
  SWELL_ROOTS_HZ,
  TONE_DURATION_MS,
} from "../../src/shared/constants";
import {
  resetAudioEngine,
  scheduleSpatialTone,
  scheduleSwell,
  scheduleTone,
  setAudioEnabled,
  readyContext,
  resumeAudioContext,
  beginActivity,
  endActivity,
  isFocalActivityPlaying,
  getAudioLog,
  withActivity,
} from "../../src/content/audio/engine";
import {
  churnTick,
  freqForY,
  magnitudeOf,
  panForX,
  swellVoicing,
  timbreForRole,
} from "../../src/content/audio/mapping";
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

/** The engine's own context, typed as the fake it actually is. */
function engineCtx(): FakeAudioContext {
  return readyContext() as unknown as FakeAudioContext;
}

describe("SPEC 9.3 — the spatial mapping", () => {
  it("pan(x) = clamp(2x - 1, -0.95, 0.95)", () => {
    expect(panForX(0.5)).toBe(0);
    expect(panForX(0.75)).toBeCloseTo(0.5);
    expect(panForX(0)).toBe(-0.95);
    expect(panForX(1)).toBe(0.95);
  });

  it("pan is monotonically increasing in x", () => {
    const xs = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1];
    const pans = xs.map(panForX);
    for (let i = 1; i < pans.length; i++) {
      expect(pans[i]).toBeGreaterThanOrEqual(pans[i - 1]);
    }
    expect(pans[pans.length - 1]).toBeGreaterThan(pans[0]);
  });

  it("freq(y) spans two octaves: y=1 -> 220 Hz, y=0 -> 880 Hz", () => {
    expect(freqForY(1)).toBeCloseTo(220);
    expect(freqForY(0.5)).toBeCloseTo(440);
    expect(freqForY(0)).toBeCloseTo(880);
  });

  it("frequency is strictly decreasing in y — higher on the page is higher in pitch", () => {
    const ys = [0, 0.2, 0.4, 0.6, 0.8, 1];
    const freqs = ys.map(freqForY);
    for (let i = 1; i < freqs.length; i++) {
      expect(freqs[i]).toBeLessThan(freqs[i - 1]);
    }
  });

  it("the timbre table matches SPEC 9.3 row for row", () => {
    expect(timbreForRole("link")).toEqual({ type: "sine", peak: 0.16, lowpass: false });
    expect(timbreForRole("tab")).toEqual({ type: "sine", peak: 0.16, lowpass: false });
    expect(timbreForRole("menuitem")).toEqual({ type: "sine", peak: 0.16, lowpass: false });
    expect(timbreForRole("button")).toEqual({ type: "triangle", peak: 0.18, lowpass: false });
    expect(timbreForRole("checkbox")).toEqual({ type: "triangle", peak: 0.18, lowpass: false });
    expect(timbreForRole("combobox")).toEqual({ type: "triangle", peak: 0.18, lowpass: false });
    expect(timbreForRole("textbox")).toEqual({ type: "square", peak: 0.14, lowpass: true });
    expect(timbreForRole("searchbox")).toEqual({ type: "square", peak: 0.14, lowpass: true });
    const other = timbreForRole("heading");
    expect(other.type).toBe("sine");
    expect(other.peak).toBeCloseTo(0.16 * 0.7);
  });
});

describe("SPEC 9.5 — the audio graph", () => {
  it("creates one oscillator, gain and panner per tone and never reuses them", () => {
    const context = engineCtx();
    scheduleSpatialTone(context as unknown as AudioContext, { x: 0.5, y: 0.5, role: "button" }, 10);
    scheduleSpatialTone(context as unknown as AudioContext, { x: 0.5, y: 0.5, role: "button" }, 11);
    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators[0]).not.toBe(ctx.oscillators[1]);
    expect(ctx.panners).toHaveLength(2);
  });

  it("routes every tone through one shared master bus, built once", () => {
    const context = engineCtx() as unknown as AudioContext;
    scheduleSpatialTone(context, { x: 0.2, y: 0.2, role: "link" }, 10);
    scheduleSpatialTone(context, { x: 0.8, y: 0.8, role: "link" }, 11);
    // One gain per tone plus exactly one master gain, and one limiter total.
    expect(ctx.gains).toHaveLength(3);
    expect(ctx.compressors).toHaveLength(1);
    // The panners feed the master gain, not the destination directly.
    const master = ctx.gains[0];
    expect(ctx.panners[0].connectedTo).toContain(master);
    expect(ctx.panners[1].connectedTo).toContain(master);
  });

  it("gives the Input role class a lowpass at freq x 4 with Q 1 (SPEC 9.3)", () => {
    const context = engineCtx() as unknown as AudioContext;
    scheduleSpatialTone(context, { x: 0.5, y: 0.25, role: "textbox" }, 10);
    expect(ctx.filters).toHaveLength(1);
    const filter = ctx.filters[0];
    expect(filter.type).toBe("lowpass");
    expect(filter.frequency.calls[0].value).toBeCloseTo(
      freqForY(0.25) * INPUT_FILTER_FREQ_MULTIPLIER
    );
    expect(filter.Q.calls[0].value).toBe(INPUT_FILTER_Q);
  });

  it("gives role classes without a filter no filter at all", () => {
    const context = engineCtx() as unknown as AudioContext;
    scheduleSpatialTone(context, { x: 0.5, y: 0.5, role: "button" }, 10);
    expect(ctx.filters).toHaveLength(0);
  });

  it("schedules against the context clock, never setTimeout", () => {
    const context = engineCtx() as unknown as AudioContext;
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const t0 = ctx.currentTime;
    [0, 1, 2, 3].forEach((i) => {
      scheduleSpatialTone(context, { x: 0.5, y: 0.5, role: "button" }, t0 + i * 0.07);
    });
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    const starts = ctx.oscillators.map((o) => o.startedAt!);
    expect(starts).toEqual([t0, t0 + 0.07, t0 + 0.14, t0 + 0.21]);
    setTimeoutSpy.mockRestore();
  });

  it("gives every tone the SPEC 9.3 envelope, 90 ms end to end", () => {
    const context = engineCtx() as unknown as AudioContext;
    const t0 = 10;
    scheduleSpatialTone(context, { x: 0.5, y: 0.5, role: "button" }, t0);
    const osc = ctx.oscillators[0];
    expect(osc.stoppedAt! - osc.startedAt!).toBeCloseTo(TONE_DURATION_MS / 1000, 6);
  });
});

describe("SPEC 9.3 — the exponential-ramp-to-zero rule", () => {
  it("releases to GAIN_FLOOR and only then sets 0", () => {
    const context = engineCtx() as unknown as AudioContext;
    scheduleSpatialTone(context, { x: 0.5, y: 0.5, role: "button" }, 10);
    // The master gain is gains[0]; the tone's own envelope is gains[1].
    const envelope = ctx.gains[1].gain;
    const exponential = envelope.calls.filter(
      (c) => c.method === "exponentialRampToValueAtTime"
    );
    expect(exponential).toHaveLength(1);
    expect(exponential[0].value).toBe(GAIN_FLOOR);
    expect(exponential[0].value).not.toBe(0);

    // ...and the very next call is the setValueAtTime(0) at the same instant.
    const index = envelope.calls.indexOf(exponential[0]);
    const next = envelope.calls[index + 1];
    expect(next.method).toBe("setValueAtTime");
    expect(next.value).toBe(0);
    expect(next.time).toBe(exponential[0].time);
  });

  it("a real AudioParam would throw on a ramp to 0 — the fake proves the test can see it", () => {
    const param = ctx.createGain().gain;
    expect(() => param.exponentialRampToValueAtTime(0, 1)).toThrow(RangeError);
  });

  it("the swell releases through the same floor", () => {
    const context = engineCtx() as unknown as AudioContext;
    scheduleSwell(
      context,
      {
        rootHz: 82.41,
        durationMs: 600,
        peakGain: 0.08,
        filterStartHz: 100,
        filterPeakHz: 800,
        filterSettleHz: 165,
        filterQ: 7,
        attackRatio: 0.45,
        detuneCents: 7,
        centrePan: 0,
        width: 0.3,
        bodyGainRatio: 0.55,
      },
      10
    );
    // gains[0] is the master; every voice after it must hit the floor, not 0.
    for (const gain of ctx.gains.slice(1)) {
      const exponential = gain.gain.valuesFor("exponentialRampToValueAtTime");
      expect(exponential).toEqual([GAIN_FLOOR]);
    }
  });
});

describe("the swell (HD-10)", () => {
  it("is three voices: two detuned saws spread in stereo and a sine holding the root", () => {
    const context = engineCtx() as unknown as AudioContext;
    scheduleSwell(
      context,
      {
        rootHz: 65.41,
        durationMs: 700,
        peakGain: 0.1,
        filterStartHz: 82,
        filterPeakHz: 700,
        filterSettleHz: 131,
        filterQ: 7,
        attackRatio: 0.45,
        detuneCents: 7,
        centrePan: 0.2,
        width: 0.3,
        bodyGainRatio: 0.55,
      },
      10
    );
    expect(ctx.oscillators.map((o) => o.type)).toEqual(["sawtooth", "sawtooth", "sine"]);
    expect(ctx.oscillators[0].detune.calls[0].value).toBe(-7);
    expect(ctx.oscillators[1].detune.calls[0].value).toBe(7);
    // Spread around the centre, and the sine sits in the middle of them.
    const pans = ctx.panners.map((p) => p.pan.calls[0].value);
    expect(pans[0]).toBeCloseTo(-0.1);
    expect(pans[1]).toBeCloseTo(0.5);
    expect(pans[2]).toBeCloseTo(0.2);
    // Only the saws are filtered: filtering the sine would remove the
    // fundamental it exists to supply.
    expect(ctx.filters).toHaveLength(2);
  });

  it("sweeps the cutoff up over the attack and settles it back", () => {
    const context = engineCtx() as unknown as AudioContext;
    scheduleSwell(
      context,
      {
        rootHz: 110,
        durationMs: 400,
        peakGain: 0.05,
        filterStartHz: 137.5,
        filterPeakHz: 660,
        filterSettleHz: 220,
        filterQ: 7,
        attackRatio: 0.5,
        detuneCents: 7,
        centrePan: 0,
        width: 0,
        bodyGainRatio: 0.55,
      },
      10
    );
    const sweep = ctx.filters[0].frequency.calls;
    expect(sweep.map((c) => c.value)).toEqual([137.5, 660, 220]);
    expect(sweep[1].time).toBeCloseTo(10.2); // attack ends halfway through 400 ms
    expect(sweep[2].time).toBeCloseTo(10.4);
  });

  it("maps a bigger change to a deeper root, a longer swell and a louder one", () => {
    const small = swellVoicing(magnitudeOf(4));
    const large = swellVoicing(magnitudeOf(48));
    expect(large.rootHz).toBeLessThan(small.rootHz);
    expect(large.durationMs).toBeGreaterThan(small.durationMs);
    expect(large.peakGain).toBeGreaterThan(small.peakGain);
    // The root is quantized to the table, so two swells make an interval
    // rather than a glide.
    expect(SWELL_ROOTS_HZ).toContain(small.rootHz);
    expect(SWELL_ROOTS_HZ).toContain(large.rootHz);
    expect(large.rootHz).toBe(SWELL_ROOTS_HZ[SWELL_ROOTS_HZ.length - 1]);
  });

  it("saturates rather than running off the bottom of the table", () => {
    expect(magnitudeOf(10_000)).toBe(1);
    expect(swellVoicing(magnitudeOf(10_000)).rootHz).toBe(
      SWELL_ROOTS_HZ[SWELL_ROOTS_HZ.length - 1]
    );
  });

  it("widens the stereo spread with the spread of the change", () => {
    expect(swellVoicing(0.5, 0).width).toBe(0);
    expect(swellVoicing(0.5, 1).width).toBeGreaterThan(swellVoicing(0.5, 0.2).width);
  });
});

describe("churn ticks (HD-10)", () => {
  it("ascends through the pitch set and spreads across the changed span", () => {
    const ticks = [0, 1, 2, 3].map((i) => churnTick(i, 4, 0.2, 0.8));
    // An arpeggio, not a random scatter.
    expect(ticks.map((t) => t.freqHz)).toEqual([1760, 2093.0, 2637.02, 3135.96]);
    // Panned left to right across the span, never stacked at an edge.
    const pans = ticks.map((t) => t.pan);
    for (let i = 1; i < pans.length; i++) {
      expect(pans[i]).toBeGreaterThan(pans[i - 1]);
    }
    expect(pans[0]).toBeGreaterThan(panForX(0.2));
    expect(pans[pans.length - 1]).toBeLessThan(panForX(0.8));
  });

  it("is deterministic — the same mutation always sounds the same", () => {
    expect(churnTick(2, 5, 0.1, 0.9)).toEqual(churnTick(2, 5, 0.1, 0.9));
  });

  it("centres a single tick instead of pinning it to an edge", () => {
    expect(churnTick(0, 1, 0.4, 0.4).pan).toBeCloseTo(panForX(0.4));
  });
});

describe("SPEC 5.13 — settings.audioEnabled", () => {
  it("schedules nothing at all when cues are off", () => {
    setAudioEnabled(false);
    const context = engineCtx() as unknown as AudioContext;
    scheduleSpatialTone(context, { x: 0.5, y: 0.5, role: "button" }, 10);
    scheduleSwell(
      context,
      {
        rootHz: 110,
        durationMs: 400,
        peakGain: 0.05,
        filterStartHz: 137,
        filterPeakHz: 660,
        filterSettleHz: 220,
        filterQ: 7,
        attackRatio: 0.5,
        detuneCents: 7,
        centrePan: 0,
        width: 0,
        bodyGainRatio: 0.55,
      },
      10
    );
    expect(ctx.oscillators).toHaveLength(0);
    expect(getAudioLog()).toHaveLength(0);
  });

  it("still reports the time a muted tone would have ended, so callers can chain", () => {
    setAudioEnabled(false);
    const context = engineCtx() as unknown as AudioContext;
    const end = scheduleTone(
      context,
      {
        freqHz: 440,
        type: "sine",
        peakGain: 0.1,
        pan: 0,
        attackMs: 10,
        sustainMs: 50,
        releaseMs: 30,
        layer: "transport",
      },
      10
    );
    expect(end).toBeCloseTo(10.09);
  });
});

describe("SPEC 9.8 step 5 — focal activity", () => {
  it("tracks scans and batches independently", () => {
    expect(isFocalActivityPlaying()).toBe(false);
    beginActivity("scan");
    beginActivity("batch");
    endActivity("scan");
    expect(isFocalActivityPlaying()).toBe(true);
    endActivity("batch");
    expect(isFocalActivityPlaying()).toBe(false);
  });

  it("releases the activity even when the work throws", async () => {
    await expect(
      withActivity("batch", async () => {
        throw new Error("the click failed");
      })
    ).rejects.toThrow("the click failed");
    expect(isFocalActivityPlaying()).toBe(false);
  });
});

describe("SPEC 9.6 — lifecycle", () => {
  it("returns no context while the autoplay policy keeps it suspended, and asks it to resume", async () => {
    resetAudioEngine();
    vi.unstubAllGlobals();
    const suspended = installFakeAudioContext(vi.stubGlobal);
    suspended.state = "suspended";
    expect(readyContext()).toBeNull();
    // The resume was requested, so the next cue finds a running context.
    await Promise.resolve();
    await Promise.resolve();
    expect(suspended.state).toBe("running");
    expect(readyContext()).not.toBeNull();
  });

  it("an ambient cue that cannot resume the context never disables audio for the page", async () => {
    // The failure mode this guards: a mutation fires before the user has
    // touched the page, the resume is refused by the autoplay policy, and
    // SPEC 9.6 rule 4 takes the whole cue channel down with it — so the listen
    // tone never plays either.
    resetAudioEngine();
    vi.unstubAllGlobals();
    const blocked = installFakeAudioContext(vi.stubGlobal);
    blocked.state = "suspended";
    blocked.resume = () => Promise.reject(new Error("blocked by autoplay policy"));

    expect(readyContext()).toBeNull();
    await Promise.resolve();
    await Promise.resolve();

    // The gesture path can still resume it, because nothing gave up on it.
    blocked.resume = async () => {
      blocked.state = "running";
    };
    await resumeAudioContext();
    expect(readyContext()).not.toBeNull();
  });

  it("logs what it scheduled, with the layer that produced it", () => {
    const context = engineCtx() as unknown as AudioContext;
    scheduleSpatialTone(context, { x: 0.25, y: 0.5, role: "button" }, 10, {
      gainMultiplier: 0.6,
    });
    const log = getAudioLog();
    expect(log).toHaveLength(1);
    expect(log[0].layer).toBe("point");
    expect(log[0].freqHz).toBeCloseTo(440);
    expect(log[0].pan).toBeCloseTo(-0.5);
    expect(log[0].peakGain).toBeCloseTo(0.18 * 0.6);
  });
});
