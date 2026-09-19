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

/** True if the AudioContext is usable. A suspended ctx that cannot be resumed sets this false. */
export function isAudioAvailable(): boolean {
  return audioAvailable;
}
