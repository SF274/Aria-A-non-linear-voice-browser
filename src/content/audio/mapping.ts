/**
 * Audio mappings — T1-02 (F-10), SPEC 9.3, plus the generative mappings HD-10
 * adds for mutation sonification (SPEC 9.8, DEV-009).
 *
 * Everything here is a pure function of numbers. No `AudioContext`, no DOM, no
 * `Math.random`: the same mutation always produces the same sound, which is
 * what makes the soundscape learnable by a user and assertable by a test.
 */

import {
  CHURN_TICK_FREQS_HZ,
  GAIN_FLOOR,
  INPUT_FILTER_FREQ_MULTIPLIER,
  INPUT_FILTER_Q,

  ROLE_CLASS_BY_ROLE,
  ROLE_CLASS_TIMBRE,
  type RoleClass,
  SWELL_DURATION_MS,
  SWELL_FILTER_PEAK_MULTIPLE,
  SWELL_FULL_SCALE_ELEMENTS,
  SWELL_PEAK_GAIN,
  SWELL_ROOTS_HZ,
  SWELL_WIDTH_MAX,
  TONE_BASE_FREQ_HZ,
  TONE_OCTAVE_SPAN,
} from "../../shared/constants";
import { panForX } from "../../shared/spatial";

/** Clamp to [0, 1]. */
export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Linear interpolation between a and b. `t` is clamped to [0, 1]. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

/**
 * SPEC 9.3: horizontal position -> stereo pan. Defined in `shared/spatial.ts`
 * because the service worker pans speech with the same formula (HD-12), and
 * re-exported here so audio code has one obvious place to import from.
 */
export { panForX };

/** SPEC 9.3: vertical position -> pitch. y=1 -> 220 Hz, y=0 -> 880 Hz. */
export function freqForY(y: number): number {
  return TONE_BASE_FREQ_HZ * Math.pow(2, TONE_OCTAVE_SPAN * (1 - y));
}

export interface Timbre {
  type: OscillatorType;
  peak: number;
  lowpass: boolean;
}

/** SPEC 9.3 timbre table: oscillator, peak gain and (for inputs) a lowpass. */
export function timbreForRole(role: string): Timbre {
  const roleClass: RoleClass =
    (ROLE_CLASS_BY_ROLE as Record<string, RoleClass | undefined>)[role] ?? "other";
  switch (roleClass) {
    case "navigational":
      return { type: "sine", peak: ROLE_CLASS_TIMBRE.navigational.peakGain, lowpass: false };
    case "control":
      return { type: "triangle", peak: ROLE_CLASS_TIMBRE.control.peakGain, lowpass: false };
    case "input":
      return { type: "square", peak: ROLE_CLASS_TIMBRE.input.peakGain, lowpass: true };
    case "other":
      // SPEC 9.3 gives "other" a x0.7 gain and no peak of its own: scale the
      // sine (navigational) peak rather than inventing a fourth number.
      return {
        type: "sine",
        peak: ROLE_CLASS_TIMBRE.navigational.peakGain * ROLE_CLASS_TIMBRE.other.gainMultiplier,
        lowpass: false,
      };
  }
}

/** SPEC 9.3: the lowpass that gives the Input role class its muffled timbre. */
export function inputFilterFor(freqHz: number): { frequency: number; q: number } {
  return { frequency: freqHz * INPUT_FILTER_FREQ_MULTIPLIER, q: INPUT_FILTER_Q };
}

/**
 * `exponentialRampToValueAtTime` throws on a target of exactly 0 (SPEC 9.3).
 * Every release ramp in the engine goes through this floor first.
 */
export const RELEASE_FLOOR = GAIN_FLOOR;

// ---------------------------------------------------------------------------
// Mutation sonification (SPEC 9.8 + HD-10)
// ---------------------------------------------------------------------------

/**
 * How much of the page changed, on 0..1. `elements` is the subtree-weighted
 * count of added elements; SWELL_FULL_SCALE_ELEMENTS is "the whole view was
 * rebuilt". Saturating rather than unbounded: past a full view rebuild there is
 * no louder thing to say.
 */
export function magnitudeOf(elements: number): number {
  return clamp01(elements / SWELL_FULL_SCALE_ELEMENTS);
}

export interface SwellVoicing {
  rootHz: number;
  durationMs: number;
  peakGain: number;
  /** Cutoff at the top of the sweep, in Hz. */
  filterPeakHz: number;
  /** Half-width of the stereo spread around the centroid, in pan units. */
  width: number;
}

/**
 * The swell's voicing, derived entirely from how much arrived and how wide it
 * landed. Bigger means deeper, longer, louder and brighter at the top of the
 * sweep; wider means further apart in the stereo field.
 *
 * The root is quantized to SWELL_ROOTS_HZ rather than interpolated, so a page
 * that mutates twice produces an interval a listener can name instead of a
 * glide, and so the same size of change always sounds like the same note.
 */
export function swellVoicing(magnitude: number, spreadX = 0): SwellVoicing {
  const m = clamp01(magnitude);
  const lastIndex = SWELL_ROOTS_HZ.length - 1;
  // Round, not floor: floor would give the deepest root only at exactly 1.0.
  const rootIndex = Math.min(lastIndex, Math.round(m * lastIndex));
  return {
    rootHz: SWELL_ROOTS_HZ[rootIndex],
    durationMs: lerp(SWELL_DURATION_MS.min, SWELL_DURATION_MS.max, m),
    peakGain: lerp(SWELL_PEAK_GAIN.min, SWELL_PEAK_GAIN.max, m),
    filterPeakHz:
      SWELL_ROOTS_HZ[rootIndex] *
      lerp(SWELL_FILTER_PEAK_MULTIPLE.min, SWELL_FILTER_PEAK_MULTIPLE.max, m),
    width: SWELL_WIDTH_MAX * clamp01(spreadX),
  };
}

/**
 * Tick `i` of a churn flurry: an ascending arpeggio through the pitch set,
 * panned across the horizontal span the mutation covered so a flurry reads as
 * movement rather than as one point. `spanStart` and `spanEnd` are document x
 * in 0..1; `count` is how many ticks the flurry has.
 */
export function churnTick(
  i: number,
  count: number,
  spanStart: number,
  spanEnd: number
): { freqHz: number; pan: number } {
  const freqHz = CHURN_TICK_FREQS_HZ[i % CHURN_TICK_FREQS_HZ.length];
  // Centre of the i-th of `count` equal slices, so ticks never stack at an edge.
  const t = count <= 1 ? 0.5 : (i + 0.5) / count;
  const x = lerp(clamp01(spanStart), clamp01(spanEnd), t);
  return { freqHz, pan: panForX(x) };
}
