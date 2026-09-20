/**
 * Transport tones and execution ticks — SPEC 9.4, 9.3, 7.6.3 step 5.
 *
 * These are the cues the user hears around a command rather than about the
 * page: the listen boundaries, the error pair, the positional tick per step of
 * a sequence, and the quiet "still working" click while the model is waited on.
 *
 * Every entry point is async, returns void, and swallows its own failures. The
 * caller is always in the middle of doing something that matters more than the
 * sound (SPEC 9.6).
 */

import { TONE_ATTACK_MS } from "../../shared/constants";
import {
  type CueLayer,
  getAudioContext,
  readyContext,
  resumeAudioContext,
  scheduleSpatialTone,
  scheduleTone,
  type SpatialPoint,
} from "./engine";

/**
 * SPEC 9.4's tones are given as a total duration. Attack and release are fixed
 * at the SPEC 9.3 shape and the sustain takes the remainder, so a 70 ms tone is
 * 70 ms and not 70 ms plus an envelope.
 */
const TRANSPORT_RELEASE_MS = 20;

function transportEnvelope(durationMs: number): {
  attackMs: number;
  sustainMs: number;
  releaseMs: number;
} {
  const attackMs = TONE_ATTACK_MS;
  const releaseMs = TRANSPORT_RELEASE_MS;
  return {
    attackMs,
    releaseMs,
    sustainMs: Math.max(0, durationMs - attackMs - releaseMs),
  };
}

function playCentred(
  freqHz: number,
  type: OscillatorType,
  durationMs: number,
  peakGain: number,
  layer: CueLayer = "transport",
  offsetMs = 0
): void {
  const ctx = readyContext();
  if (!ctx) return;
  scheduleTone(
    ctx,
    { freqHz, type, peakGain, pan: 0, ...transportEnvelope(durationMs), layer },
    ctx.currentTime + offsetMs / 1000
  );
}

/**
 * SPEC 9.4: 440 Hz sine, 70 ms, centre, gain 0.12.
 *
 * This is the one cue that runs inside a real user gesture, so it is also where
 * the context is resumed for everything that follows (SPEC 9.6 rule 2).
 */
export async function playListenStart(): Promise<void> {
  try {
    await resumeAudioContext();
    playCentred(440, "sine", 70, 0.12);
  } catch {
    // Degrade to silence.
  }
}

/** SPEC 9.4: 330 Hz sine, 70 ms, centre, gain 0.12. */
export async function playListenEnd(): Promise<void> {
  try {
    playCentred(330, "sine", 70, 0.12);
  } catch {
    // Degrade to silence.
  }
}

/**
 * SPEC 9.4: two 200 Hz square pulses, 60 ms each, 60 ms apart, gain 0.10.
 * Both are scheduled up front against the context clock, so the gap is exact
 * under load (SPEC 9.5).
 */
export async function playError(): Promise<void> {
  try {
    playCentred(200, "square", 60, 0.1);
    playCentred(200, "square", 60, 0.1, "transport", 120);
  } catch {
    // Degrade to silence.
  }
}

/**
 * The tick played as each action of a multi-step sequence runs, so the user
 * hears progress — and where on the page it happened — before the spoken
 * confirmation. Fire and forget: audio trouble must never delay an action.
 */
export async function playPositionalTick(target: SpatialPoint): Promise<void> {
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
 * A very quiet, very short click repeated while the service worker waits on the
 * model, so a two-second pause does not sound like a frozen system. Deliberately
 * unlike the positional ticks: one fixed pitch, dead centre, low gain, 30 ms.
 */
export async function playProcessingTick(): Promise<void> {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state !== "running") await ctx.resume();
    if (ctx.state !== "running") return;
    playCentred(1800, "sine", 30, 0.05, "processing");
  } catch {
    // Degrade to silence.
  }
}
