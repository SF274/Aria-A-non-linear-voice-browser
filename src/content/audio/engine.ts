/**
 * Audio engine — T1-02 (F-10), SPEC 9.5 and 9.6.
 *
 * One `AudioContext` per content script instance, one shared cue bus, and the
 * primitives every non-speech sound in the extension is built from. Three rules
 * shape all of it:
 *
 *   - SPEC 9.5: nodes are created per tone and dropped after `onended`.
 *     `OscillatorNode` cannot be restarted after `stop()`, so pooling is not an
 *     option that exists.
 *   - SPEC 9.5: everything in a burst is scheduled up front against
 *     `ctx.currentTime`. `setTimeout` drift is audible at 70 ms spacing.
 *   - SPEC 9.6: a dead or suspended context degrades to silence and never
 *     prevents an action, delays one, or throws into a caller.
 */

import {
  AUDIO_LOG_CAPACITY,
  CUE_LIMITER,
  CUE_MASTER_GAIN,
  GAIN_FLOOR,
  TONE_ATTACK_MS,
  TONE_RELEASE_MS,
  TONE_SUSTAIN_MS,
} from "../../shared/constants";
import { freqForY, inputFilterFor, panForX, timbreForRole } from "./mapping";

// ---------------------------------------------------------------------------
// Context lifecycle (SPEC 9.6)
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let audioAvailable = true;
let audioEnabled = true;

/** Get or lazily create the singleton `AudioContext` (SPEC 9.6 rule 1). */
export function getAudioContext(): AudioContext | null {
  if (!audioAvailable) return null;
  if (!ctx) {
    try {
      if (typeof AudioContext === "undefined") {
        audioAvailable = false;
        return null;
      }
      ctx = new AudioContext();
    } catch {
      // No audio device, or the per-page context limit is reached. Silence.
      audioAvailable = false;
      return null;
    }
  }
  return ctx;
}

/**
 * The trunk every cue passes through: `masterGain -> limiter -> destination`.
 *
 * SPEC 9.5's graph is per tone and stops at the destination. Mutation
 * sonification is the first thing that plays several voices at once, and Web
 * Audio sums them arithmetically, so without a limiter a burst that overlaps a
 * swell clips. The limiter is skipped rather than fatal when the context has no
 * compressor, so an exotic implementation still gets audio.
 */
function getMasterBus(context: AudioContext): GainNode | null {
  if (master) return master;
  try {
    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(audioEnabled ? CUE_MASTER_GAIN : 0, now);
    let tail: AudioNode = gain;
    if (typeof context.createDynamicsCompressor === "function") {
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.setValueAtTime(CUE_LIMITER.thresholdDb, now);
      limiter.knee.setValueAtTime(CUE_LIMITER.kneeDb, now);
      limiter.ratio.setValueAtTime(CUE_LIMITER.ratio, now);
      limiter.attack.setValueAtTime(CUE_LIMITER.attackSec, now);
      limiter.release.setValueAtTime(CUE_LIMITER.releaseSec, now);
      gain.connect(limiter);
      tail = limiter;
    }
    tail.connect(context.destination);
    master = gain;
    return master;
  } catch {
    return null;
  }
}

/**
 * Resume the context from inside a user gesture (SPEC 9.6 rule 2). Chrome's
 * autoplay policy starts it suspended, so the hold-to-talk keydown handler is
 * what makes every later cue audible.
 */
export async function resumeAudioContext(): Promise<void> {
  const context = getAudioContext();
  if (!context) return;
  if (context.state !== "running") {
    try {
      await context.resume();
    } catch {
      // SPEC 9.6 rule 4: stop trying, stay silent, never throw.
      audioAvailable = false;
    }
  }
}

/** True while the context is usable. A context that cannot resume sets it false. */
export function isAudioAvailable(): boolean {
  return audioAvailable;
}

/**
 * A context ready to schedule against right now, or null. Callers on a hot path
 * (a mutation burst) must not await a resume: SPEC 9.6 rule 3 resumes before a
 * scheduled sound, and here the resume is fire-and-forget so that the next
 * burst finds a running context instead of this one arriving late.
 *
 * It does *not* go through `resumeAudioContext`. That one carries SPEC 9.6 rule
 * 4 — a failed resume means no audio for the rest of the page — and that
 * conclusion is only sound when the resume happened inside a user gesture.
 * Mutation sonification fires whenever the page feels like changing, which is
 * usually before the user has touched anything, so a resume from here is
 * expected to fail and must not be able to silence the hold-to-talk tones that
 * come later.
 */
export function readyContext(): AudioContext | null {
  const context = getAudioContext();
  if (!context) return null;
  if (context.state !== "running") {
    try {
      void Promise.resolve(context.resume()).catch(() => {
        // Blocked by the autoplay policy. Expected outside a gesture.
      });
    } catch {
      // Some implementations throw synchronously instead.
    }
    return null;
  }
  return context;
}

// ---------------------------------------------------------------------------
// settings.audioEnabled (SPEC 5.13)
// ---------------------------------------------------------------------------

/**
 * Mute or unmute the whole cue channel. Both halves matter: the master gain
 * silences anything already scheduled, and the flag makes the schedulers return
 * early, so a muted session does no oscillator work at all.
 */
export function setAudioEnabled(enabled: boolean): void {
  audioEnabled = enabled;
  if (master && ctx) {
    try {
      master.gain.setValueAtTime(enabled ? CUE_MASTER_GAIN : 0, ctx.currentTime);
    } catch {
      // A dead context; the early return in the schedulers still holds.
    }
  }
}

export function isAudioEnabled(): boolean {
  return audioEnabled;
}

/** One boolean out of the stored settings object, or null if it is not a boolean. */
function readFlag(settings: unknown, key: string): boolean | null {
  if (typeof settings !== "object" || settings === null) return null;
  const value = (settings as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : null;
}

function readAudioFlag(settings: unknown): boolean | null {
  return readFlag(settings, "audioEnabled");
}

/**
 * HD-12: is mutation sonification turned on? Defaults to **false** — the
 * feature is dormant unless someone asks for it on the options page. Storage
 * being unreachable (a plain page, a test) also means off, which is the quiet
 * answer and therefore the safe one.
 */
export async function isMutationAudioEnabled(): Promise<boolean> {
  try {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return false;
    const result = await chrome.storage.local.get("settings");
    return readFlag(result?.settings, "mutationAudio") === true;
  } catch {
    return false;
  }
}

/**
 * Follow `settings.audioEnabled` from `chrome.storage.local`, and keep
 * following it when the options page saves. Settings live under a single
 * `settings` key (SPEC 5.13), so the flag is `settings.audioEnabled`, not a
 * top-level entry — the same mistake `hold-to-talk.ts` had to fix for the hold
 * key. Anything missing or malformed leaves cues on, the SPEC 5.13 default.
 */
export function followAudioSetting(): void {
  try {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    void Promise.resolve(chrome.storage.local.get("settings")).then(
      (result) => {
        const flag = readAudioFlag(result?.settings);
        if (flag !== null) setAudioEnabled(flag);
      },
      () => {
        // Storage unavailable: keep the default.
      }
    );
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area !== "local" || !changes.settings) return;
      const flag = readAudioFlag(changes.settings.newValue);
      if (flag !== null) setAudioEnabled(flag);
    });
  } catch {
    // No extension runtime (a plain page, or a test): keep the default.
  }
}

// ---------------------------------------------------------------------------
// Focal activity (SPEC 9.8 step 5)
// ---------------------------------------------------------------------------

export type AudioActivity = "scan" | "batch";

const activity = new Set<AudioActivity>();

/**
 * Mark a focal sequence as playing. A layout scan and an execution batch are
 * both answers to something the user just said; an ambient mutation burst
 * underneath them is noise on top of the one sound that matters, so SPEC 9.8
 * step 5 suppresses it entirely.
 */
export function beginActivity(kind: AudioActivity): void {
  activity.add(kind);
}

export function endActivity(kind: AudioActivity): void {
  activity.delete(kind);
}

export function isFocalActivityPlaying(): boolean {
  return activity.size > 0;
}

/** Run `fn` with a focal activity held, releasing it however `fn` ends. */
export async function withActivity<T>(kind: AudioActivity, fn: () => Promise<T>): Promise<T> {
  beginActivity(kind);
  try {
    return await fn();
  } finally {
    endActivity(kind);
  }
}

// ---------------------------------------------------------------------------
// The cue log (tests and inspection)
// ---------------------------------------------------------------------------

export type CueLayer = "transport" | "point" | "swell" | "churn" | "processing";

export interface CueRecord {
  layer: CueLayer;
  /** `Date.now()` when the cue was scheduled. */
  at: number;
  /** The `AudioContext` clock time the cue was scheduled for, in seconds. */
  when: number;
  freqHz: number;
  pan: number;
  peakGain: number;
  durationMs: number;
}

/**
 * A bounded ring of what was scheduled. An e2e test cannot listen, so this is
 * how F-17's "5 tones at 70 ms spacing" is asserted. It is exposed on the
 * content script's isolated-world `window` alongside the other test hooks in
 * `src/content/index.ts`, where a page cannot reach it, and it holds
 * coordinates and frequencies, never page content.
 */
const audioLog: CueRecord[] = [];

export function recordCue(record: CueRecord): void {
  audioLog.push(record);
  if (audioLog.length > AUDIO_LOG_CAPACITY) audioLog.shift();
}

export function getAudioLog(): CueRecord[] {
  return audioLog.slice();
}

export function clearAudioLog(): void {
  audioLog.length = 0;
}

/** Tests only: forget the context, the bus and every flag. */
export function resetAudioEngine(): void {
  ctx = null;
  master = null;
  audioAvailable = true;
  audioEnabled = true;
  activity.clear();
  audioLog.length = 0;
}

// ---------------------------------------------------------------------------
// Scheduling primitives (SPEC 9.5)
// ---------------------------------------------------------------------------

export interface ToneSpec {
  freqHz: number;
  type: OscillatorType;
  /** Peak gain, before the master bus. */
  peakGain: number;
  pan: number;
  attackMs: number;
  sustainMs: number;
  releaseMs: number;
  /** Optional filter between the oscillator and the gain. */
  filter?: { type: BiquadFilterType; frequency: number; q: number };
  layer: CueLayer;
}

/**
 * Schedule one voice at `when`, a time on the context's own clock. Returns the
 * time it ends, so a caller can chain without touching the wall clock.
 *
 * Every failure path is swallowed: a cue is never worth throwing into a content
 * script running on someone else's page (SPEC 9.6).
 */
export function scheduleTone(context: AudioContext, spec: ToneSpec, when: number): number {
  const attackEnd = when + spec.attackMs / 1000;
  const sustainEnd = attackEnd + spec.sustainMs / 1000;
  const end = sustainEnd + spec.releaseMs / 1000;

  if (!audioEnabled) return end;

  const bus = getMasterBus(context);
  if (!bus) return end;

  try {
    const osc = context.createOscillator();
    const gain = context.createGain();
    const panner = context.createStereoPanner();

    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.freqHz, when);
    panner.pan.setValueAtTime(spec.pan, when);

    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(spec.peakGain, attackEnd);
    gain.gain.setValueAtTime(spec.peakGain, sustainEnd);
    // SPEC 9.3: an exponential ramp to exactly 0 throws. Ramp to the floor,
    // then set 0.
    gain.gain.exponentialRampToValueAtTime(GAIN_FLOOR, end);
    gain.gain.setValueAtTime(0, end);

    if (spec.filter) {
      const filter = context.createBiquadFilter();
      filter.type = spec.filter.type;
      filter.frequency.setValueAtTime(spec.filter.frequency, when);
      filter.Q.setValueAtTime(spec.filter.q, when);
      osc.connect(filter);
      filter.connect(gain);
    } else {
      osc.connect(gain);
    }
    gain.connect(panner);
    panner.connect(bus);

    osc.start(when);
    osc.stop(end);

    recordCue({
      layer: spec.layer,
      at: Date.now(),
      when,
      freqHz: spec.freqHz,
      pan: spec.pan,
      peakGain: spec.peakGain,
      durationMs: spec.attackMs + spec.sustainMs + spec.releaseMs,
    });
  } catch {
    // Degrade to silence.
  }
  return end;
}

export interface SwellSpec {
  rootHz: number;
  durationMs: number;
  peakGain: number;
  /** Cutoff at the start of the sweep, at the top, and where it settles, in Hz. */
  filterStartHz: number;
  filterPeakHz: number;
  filterSettleHz: number;
  filterQ: number;
  /** Fraction of the duration spent rising. */
  attackRatio: number;
  detuneCents: number;
  /** Pan of the swell's centre, and how far the two voices spread around it. */
  centrePan: number;
  width: number;
  /** Gain of the sine that reinforces the fundamental, relative to the peak. */
  bodyGainRatio: number;
}

/**
 * A swell: two detuned sawtooth voices spread across the stereo field through a
 * resonant lowpass whose cutoff opens over the attack and settles back, plus a
 * sine at the root holding the fundamental that the filter takes out.
 *
 * It is a primitive here rather than in the sonifier because it needs the cue
 * bus, and because it is the one shape `scheduleTone` cannot express: the
 * moving cutoff is the entire gesture. Sawtooth rather than sine because at a
 * 55 Hz root the fundamental is inaudible on laptop headphones and the
 * harmonics are what carry the pitch.
 */
export function scheduleSwell(context: AudioContext, spec: SwellSpec, when: number): number {
  const duration = spec.durationMs / 1000;
  const attackEnd = when + duration * spec.attackRatio;
  const end = when + duration;

  if (!audioEnabled) return end;
  const bus = getMasterBus(context);
  if (!bus) return end;

  try {
    const voices: Array<{ type: OscillatorType; detune: number; pan: number; gain: number }> = [
      {
        type: "sawtooth",
        detune: -spec.detuneCents,
        pan: clampPan(spec.centrePan - spec.width),
        gain: spec.peakGain,
      },
      {
        type: "sawtooth",
        detune: spec.detuneCents,
        pan: clampPan(spec.centrePan + spec.width),
        gain: spec.peakGain,
      },
      {
        type: "sine",
        detune: 0,
        pan: clampPan(spec.centrePan),
        gain: spec.peakGain * spec.bodyGainRatio,
      },
    ];

    for (const voice of voices) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      const panner = context.createStereoPanner();

      osc.type = voice.type;
      osc.frequency.setValueAtTime(spec.rootHz, when);
      if (osc.detune) osc.detune.setValueAtTime(voice.detune, when);
      panner.pan.setValueAtTime(voice.pan, when);

      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(voice.gain, attackEnd);
      // SPEC 9.3's floor rule applies to every release ramp, not only to tones.
      gain.gain.exponentialRampToValueAtTime(GAIN_FLOOR, end);
      gain.gain.setValueAtTime(0, end);

      // Only the saws are filtered. Filtering the sine would remove the
      // fundamental it is there to supply.
      if (voice.type === "sawtooth") {
        const filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.Q.setValueAtTime(spec.filterQ, when);
        filter.frequency.setValueAtTime(spec.filterStartHz, when);
        filter.frequency.exponentialRampToValueAtTime(spec.filterPeakHz, attackEnd);
        filter.frequency.exponentialRampToValueAtTime(spec.filterSettleHz, end);
        osc.connect(filter);
        filter.connect(gain);
      } else {
        osc.connect(gain);
      }
      gain.connect(panner);
      panner.connect(bus);

      osc.start(when);
      osc.stop(end);
    }

    // One record per swell, not per voice: the log describes cues, not nodes.
    recordCue({
      layer: "swell",
      at: Date.now(),
      when,
      freqHz: spec.rootHz,
      pan: spec.centrePan,
      peakGain: spec.peakGain,
      durationMs: spec.durationMs,
    });
  } catch {
    // Degrade to silence.
  }
  return end;
}

function clampPan(pan: number): number {
  return Math.min(1, Math.max(-1, pan));
}

export interface SpatialPoint {
  /** Document-relative centre, 0..1 (SPEC 12.6). */
  x: number;
  y: number;
  role: string;
}

/**
 * One positional tone under the SPEC 9.3 mapping: pan from x, pitch from y,
 * timbre from role. `gainMultiplier` is how SPEC 9.8 step 4 makes a mutation
 * burst quieter than a scan without redefining the timbre table.
 */
export function scheduleSpatialTone(
  context: AudioContext,
  point: SpatialPoint,
  when: number,
  options: { gainMultiplier?: number; layer?: CueLayer } = {}
): number {
  const { type, peak, lowpass } = timbreForRole(point.role);
  const freqHz = freqForY(point.y);
  const filter = lowpass ? inputFilterFor(freqHz) : null;
  return scheduleTone(
    context,
    {
      freqHz,
      type,
      peakGain: peak * (options.gainMultiplier ?? 1),
      pan: panForX(point.x),
      attackMs: TONE_ATTACK_MS,
      sustainMs: TONE_SUSTAIN_MS,
      releaseMs: TONE_RELEASE_MS,
      filter: filter
        ? { type: "lowpass", frequency: filter.frequency, q: filter.q }
        : undefined,
      layer: options.layer ?? "point",
    },
    when
  );
}
