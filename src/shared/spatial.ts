/**
 * SPEC 9.3's horizontal mapping, shared.
 *
 * It lives here rather than in `src/content/audio/mapping.ts` because two
 * bundles need it and they must not disagree: the content script pans its cue
 * tones with it, and since HD-12 the service worker pans spoken answers with it
 * too. A second copy of this formula is how the voice and the tone that
 * describe the same element end up in different places.
 */

import { PAN_CLAMP } from "./constants";

/** SPEC 9.3: `pan(x) = clamp(2x - 1, -0.95, 0.95)`. Hard left/right are never reached. */
export function panForX(x: number): number {
  return Math.min(PAN_CLAMP, Math.max(-PAN_CLAMP, 2 * x - 1));
}
