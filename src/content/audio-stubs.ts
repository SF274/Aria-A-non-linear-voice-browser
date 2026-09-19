/**
 * Minimal audio tone stubs — SPEC §9.4, §9.6
 *
 * Implements the listenStart, listenEnd, and error transport tones for F-03.
 * These are stubs that satisfy F-03 acceptance criteria. The full audio engine
 * (F-10, T1-02) will replace this module with a richer implementation.
 *
 * SPEC §9.4 tone specs:
 *   listenStart : 440 Hz sine, 70 ms, centre, gain 0.12
 *   listenEnd   : 330 Hz sine, 70 ms, centre, gain 0.12
 *   error       : two 200 Hz square pulses, 60 ms each, 60 ms apart, gain 0.10
 *
 * SPEC §9.6 AudioContext lifecycle:
 *   1. One AudioContext per content script instance, created lazily.
 *   2. Created and resume()d inside the keydown handler (user gesture).
 *   3. Before every sound, if ctx.state !== "running", call resume().
 *   4. If resume() fails → audioAvailable = false.
 */

import {
  GAIN_FLOOR,
  INPUT_FILTER_FREQ_MULTIPLIER,
  INPUT_FILTER_Q,
  PAN_CLAMP,
  ROLE_CLASS_BY_ROLE,
  ROLE_CLASS_TIMBRE,
  type RoleClass,
  TONE_ATTACK_MS,
  TONE_BASE_FREQ_HZ,
  TONE_OCTAVE_SPAN,
  TONE_RELEASE_MS,
  TONE_SUSTAIN_MS,
} from "../shared/constants";

let _ctx: AudioContext | null = null;
let audioAvailable = true;

/** Get or lazily create the singleton AudioContext (SPEC §9.6 rule 1). */
export function getAudioContext(): AudioContext | null {
  if (!audioAvailable) return null;
  if (!_ctx) {
    try {
      _ctx = new AudioContext();
    } catch {
      audioAvailable = false;
      return null;
    }
  }
  return _ctx;
}

/** Resume the AudioContext inside a user-gesture handler (SPEC §9.6 rule 2). */
export async function resumeAudioContext(): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state !== "running") {
    try {
      await ctx.resume();
    } catch {
      audioAvailable = false;
    }
  }
}

/**
 * Play a simple tone via a fresh OscillatorNode → GainNode → StereoPannerNode
 * graph (SPEC §9.5). Nodes are created per tone and GC'd after onended (§9.5).
 */
function playTone(
  ctx: AudioContext,
  freqHz: number,
  type: OscillatorType,
  durationMs: number,
  peakGain: number,
  pan = 0,
  startTime?: number
): void {
  const t0 = startTime ?? ctx.currentTime;
  const duration = durationMs / 1000;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const panner = ctx.createStereoPanner();

  osc.type = type;
  osc.frequency.setValueAtTime(freqHz, t0);
  panner.pan.setValueAtTime(pan, t0);

  // Simple linear attack + flat sustain + release to near-zero.
  const attackEnd = t0 + 0.01;
  const sustainEnd = attackEnd + (duration - 0.01 - 0.01);
  const releaseEnd = sustainEnd + 0.01;

  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peakGain, attackEnd);
  gain.gain.setValueAtTime(peakGain, sustainEnd);
  // SPEC §9.3: never ramp to exactly 0; ramp to 0.0001 then set 0.
  gain.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);
  gain.gain.setValueAtTime(0, releaseEnd);

  osc.connect(gain);
  gain.connect(panner);
  panner.connect(ctx.destination);

  osc.start(t0);
  osc.stop(releaseEnd);
}

// ---------------------------------------------------------------------------
// Transport tones (SPEC §9.4)
// ---------------------------------------------------------------------------

/** SPEC §9.4: 440 Hz sine, 70 ms, centre, gain 0.12. */
export async function playListenStart(): Promise<void> {
  await resumeAudioContext();
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== "running") return;
  playTone(ctx, 440, "sine", 70, 0.12);
}

/** SPEC §9.4: 330 Hz sine, 70 ms, centre, gain 0.12. */
export async function playListenEnd(): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== "running") return;
  playTone(ctx, 330, "sine", 70, 0.12);
}

/**
 * SPEC §9.4: two 200 Hz square pulses, 60 ms each, 60 ms apart, gain 0.10.
 * Both pulses are scheduled up front against AudioContext.currentTime so
 * there is no setTimeout drift (SPEC §9.5 requirement).
 */
export async function playError(): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== "running") return;
  const t0 = ctx.currentTime;
  playTone(ctx, 200, "square", 60, 0.1, 0, t0);
  playTone(ctx, 200, "square", 60, 0.1, 0, t0 + 0.12); // 60 ms pulse + 60 ms gap
}

// ---------------------------------------------------------------------------
// Execution ticks (SPEC 9.3, 7.6.3 step 5) and the "still working" tick
// ---------------------------------------------------------------------------

/** SPEC 9.3: horizontal position -> stereo pan. */
export function panForX(x: number): number {
  return Math.min(PAN_CLAMP, Math.max(-PAN_CLAMP, 2 * x - 1));
}

/** SPEC 9.3: vertical position -> pitch. y=1 -> 220 Hz, y=0 -> 880 Hz. */
export function freqForY(y: number): number {
  return TONE_BASE_FREQ_HZ * Math.pow(2, TONE_OCTAVE_SPAN * (1 - y));
}

export interface TickTarget {
  /** Normalized document coordinates of the element centre, 0..1. */
  x: number;
  y: number;
  role: string;
}

/** SPEC 9.3 timbre table: oscillator, peak gain and (for inputs) a lowpass. */
export function timbreForRole(role: string): { type: OscillatorType; peak: number; lowpass: boolean } {
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
      // SPEC 9.3 gives "other" a x0.7 gain and no peak of its own: scale the sine (navigational) peak.
      return {
        type: "sine",
        peak: ROLE_CLASS_TIMBRE.navigational.peakGain * ROLE_CLASS_TIMBRE.other.gainMultiplier,
        lowpass: false,
      };
  }
}

/**
 * One positional tick: pan from x, pitch from y, timbre from role (SPEC 9.3).
 * Envelope: attack, sustain, release from the SPEC constants (90 ms total). The
 * graph is scheduled against currentTime, not setTimeout (SPEC 9.5).
 */
function scheduleSpatialTone(ctx: AudioContext, target: TickTarget, when: number): void {
  const { type, peak, lowpass } = timbreForRole(target.role);
  const freq = freqForY(target.y);
  const attackEnd = when + TONE_ATTACK_MS / 1000;
  const sustainEnd = attackEnd + TONE_SUSTAIN_MS / 1000;
  const end = sustainEnd + TONE_RELEASE_MS / 1000;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const panner = ctx.createStereoPanner();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, when);
  panner.pan.setValueAtTime(panForX(target.x), when);

  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(peak, attackEnd);
  gain.gain.setValueAtTime(peak, sustainEnd);
  // SPEC 9.3: never ramp to exactly 0; ramp to GAIN_FLOOR, then set 0.
  gain.gain.exponentialRampToValueAtTime(GAIN_FLOOR, end);
  gain.gain.setValueAtTime(0, end);

  if (lowpass) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(freq * INPUT_FILTER_FREQ_MULTIPLIER, when);
    filter.Q.setValueAtTime(INPUT_FILTER_Q, when);
    osc.connect(filter);
    filter.connect(gain);
  } else {
    osc.connect(gain);
  }
  gain.connect(panner);
  panner.connect(ctx.destination);

  osc.start(when);
  osc.stop(end);
}

/**
 * The tick played as each action of a multi-step sequence runs, so the user
 * hears progress (and where on the page) before the spoken confirmation.
 * Never throws and never waits on the caller: a dead AudioContext must not
 * stop an action from being performed (SPEC 9.6).
 */
export async function playPositionalTick(target: TickTarget): Promise<void> {
  try {
    await resumeAudioContext();
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== "running") return;
    scheduleSpatialTone(ctx, target, ctx.currentTime);
  } catch {
    // Degrade to silence.
  }
}

/**
 * A very quiet, very short click that repeats while the service worker waits on
 * the model, so a two-second pause does not sound like a frozen system. It is
 * deliberately unlike the positional ticks: one fixed pitch, dead centre, low
 * gain, 30 ms.
 */
export async function playProcessingTick(): Promise<void> {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state !== "running") await ctx.resume();
    if (ctx.state !== "running") return;
    playTone(ctx, 1800, "sine", 30, 0.05);
  } catch {
    // Degrade to silence.
  }
}

/** True if the AudioContext is usable. A suspended ctx that cannot be resumed sets this false. */
export function isAudioAvailable(): boolean {
  return audioAvailable;
}
