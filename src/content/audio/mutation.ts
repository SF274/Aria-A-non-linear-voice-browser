/**
 * Mutation sonification — T2-01 (F-17), SPEC 9.8 and 12.9, extended by HD-10
 * (DEV-009).
 *
 * A modern page arrives in pieces: results pop in, a framework re-renders, a
 * route changes under a URL that never reloads. With the screen off all of that
 * is silent, and the user is left guessing whether anything happened. This
 * turns it into a sound that says three things at once — how much arrived
 * (depth), where it landed (stereo position), and what kind of thing it was
 * (timbre).
 *
 * Three layers:
 *
 *   swell   a deep, filtered, stereo-spread rise, sized by how much of the page
 *           changed. This is the body of the event.
 *   points  SPEC 9.8's eight tones: one per newly interactive element, under
 *           the standard SPEC 9.3 mapping at 0.6 gain. This is the detail.
 *   churn   short, bright, struck-glass clicks for text that changed without
 *           adding a control. This is the texture, and it is the only layer a
 *           quiet page produces.
 *
 * The performance rule is absolute. `MutationObserver` can deliver thousands of
 * records in one callback, and this callback runs on someone else's page. So
 * the callback counts and nothing else: no `getBoundingClientRect`, no
 * `querySelectorAll`, no allocation per node beyond a bounded sample. Every
 * layout read happens at flush time, which the SPEC 9.8 rate limit already
 * holds to once per 1200 ms.
 */

import {
  CHURN_TICK_DURATION_MS,
  CHURN_TICK_FILTER_Q,
  CHURN_TICK_MAX,
  CHURN_TICK_PEAK_GAIN,
  CHURN_TICK_SPACING_MS,
  MUTATION_CHURN_DEBOUNCE_MS,
  MUTATION_GAIN_MULTIPLIER,
  MUTATION_GEOMETRY_SAMPLE_CAP,
  MUTATION_MIN_ADDED_ELEMENTS,
  MUTATION_MIN_TEXT_CHANGES,
  MUTATION_POINT_CAP,
  MUTATION_POINT_SPACING_MS,
  MUTATION_RATE_LIMIT_MS,
  MUTATION_RECORD_SCAN_CAP,
  MUTATION_SUBTREE_COUNT_CAP,
  SWELL_ATTACK_RATIO,
  SWELL_BODY_GAIN_RATIO,
  SWELL_DETUNE_CENTS,
  SWELL_FILTER_Q,
  SWELL_FILTER_SETTLE_MULTIPLE,
  SWELL_FILTER_START_MULTIPLE,
  SWELL_MIN_ELEMENTS,
} from "../../shared/constants";
import type { ElementIndex, MutationEvent } from "../../shared/contracts";
import {
  isFocalActivityPlaying,
  readyContext,
  scheduleSpatialTone,
  scheduleSwell,
  scheduleTone,
  type SpatialPoint,
} from "./engine";
import { churnTick, clamp01, magnitudeOf, panForX, swellVoicing } from "./mapping";

/** What the observer accumulated since the last flush. */
export interface BurstInput {
  /** Added elements that are enabled and in the viewport (SPEC 9.8 step 2). */
  points: SpatialPoint[];
  /** Subtree-weighted count of added elements. Sizes the swell. */
  weightedAdded: number;
  /** Raw count of added elements, before subtree weighting. */
  addedElements: number;
  /** Text nodes added plus `characterData` edits. */
  textChanges: number;
  /** Horizontal extent of the change, document-relative 0..1. */
  spanStart: number;
  spanEnd: number;
  centroidX: number;
}

export type BurstOutcome =
  | "played"
  | "below-threshold"
  | "suppressed-activity"
  | "rate-limited"
  | "no-audio";

/**
 * Cheap gate, run before anything expensive and before the rate limit is spent.
 *
 * A spinner swapping in, one label rewriting itself, a class toggling: below
 * this the page has not materially changed. It matters more than it looks —
 * the demo page replaces the results region with a loading indicator and only
 * injects the five flights 800 ms later. Sonifying the indicator would spend
 * the 1200 ms rate limit and leave the event the user actually asked for
 * silent.
 */
export function isWorthSonifying(input: {
  points: SpatialPoint[];
  addedElements: number;
  textChanges: number;
}): boolean {
  return (
    input.points.length > 0 ||
    input.addedElements >= MUTATION_MIN_ADDED_ELEMENTS ||
    input.textChanges >= MUTATION_MIN_TEXT_CHANGES
  );
}

/**
 * SPEC 9.8 steps 2 and 3: of the entries the index diff calls new, keep the
 * ones that are enabled and in the viewport, sort by y then x, cap at eight.
 * Sorting by position rather than by document order is what makes a burst
 * describe a shape instead of a list.
 */
export function selectPoints(addedIds: string[], index: ElementIndex): SpatialPoint[] {
  const added = new Set(addedIds);
  return index.entries
    .filter((entry) => added.has(entry.id) && entry.enabled && entry.inViewport)
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))
    .slice(0, MUTATION_POINT_CAP)
    .map((entry) => ({ x: entry.x, y: entry.y, role: entry.role }));
}

/**
 * Schedule one burst. Returns why it did or did not play, which is what the
 * tests assert on and what makes a silent page explainable.
 *
 * Order matters: the cheap threshold first, then SPEC 9.8 step 5's
 * suppression, then step 6's rate limit, and only then the context. Nothing
 * that did not make a sound is allowed to consume the rate limit.
 */
export function sonifyBurst(input: BurstInput, state: { lastBurstAt: number }, now: number): BurstOutcome {
  if (!isWorthSonifying(input)) return "below-threshold";
  // SPEC 9.8 step 5: a scan or an execution batch is a direct answer to
  // something the user said. Ambient sound underneath it is noise.
  if (isFocalActivityPlaying()) return "suppressed-activity";
  // SPEC 9.8 step 6: not optional. A polling widget otherwise plays forever.
  if (now - state.lastBurstAt < MUTATION_RATE_LIMIT_MS) return "rate-limited";

  const ctx = readyContext();
  if (!ctx) return "no-audio";

  const t0 = ctx.currentTime;
  const spread = clamp01(input.spanEnd - input.spanStart);
  let scheduled = 0;

  // Layer 1 — the swell. Only for a change big enough to have a body.
  const swelled = input.weightedAdded >= SWELL_MIN_ELEMENTS;
  if (swelled) {
    const voicing = swellVoicing(magnitudeOf(input.weightedAdded), spread);
    scheduleSwell(
      ctx,
      {
        rootHz: voicing.rootHz,
        durationMs: voicing.durationMs,
        peakGain: voicing.peakGain,
        filterStartHz: voicing.rootHz * SWELL_FILTER_START_MULTIPLE,
        filterPeakHz: voicing.filterPeakHz,
        filterSettleHz: voicing.rootHz * SWELL_FILTER_SETTLE_MULTIPLE,
        filterQ: SWELL_FILTER_Q,
        attackRatio: SWELL_ATTACK_RATIO,
        detuneCents: SWELL_DETUNE_CENTS,
        centrePan: panForX(input.centroidX),
        width: voicing.width,
        bodyGainRatio: SWELL_BODY_GAIN_RATIO,
      },
      t0
    );
    scheduled++;
  }

  // Layer 2 — SPEC 9.8 step 4, unchanged: 70 ms apart, 0.6 gain, all scheduled
  // up front against the context clock so the spacing survives a busy page.
  // They start at t0, not after the swell's attack: F-17 requires the first
  // tone within 250 ms of the injection and the index debounce has used 150 of
  // those already. Landing on top of the swell is also simply how it sounds
  // right — the detail emerges from the body.
  input.points.forEach((point, i) => {
    scheduleSpatialTone(ctx, point, t0 + (i * MUTATION_POINT_SPACING_MS) / 1000, {
      gainMultiplier: MUTATION_GAIN_MULTIPLIER,
    });
    scheduled++;
  });

  // Layer 3 — churn. Skipped entirely when points played: they already say "the
  // page changed", and a flurry underneath them is the auditory overload this
  // project exists to avoid.
  //
  // It is sized by text changes, and, when the change was too small to swell
  // and added nothing interactive, by the added elements instead. Without that
  // second clause a two-element addition with no text would pass the threshold,
  // spend the rate limit and make no sound at all.
  if (input.points.length === 0) {
    const events = Math.max(input.textChanges, swelled ? 0 : input.addedElements);
    const count = Math.min(events, CHURN_TICK_MAX);
    for (let i = 0; i < count; i++) {
      const { freqHz, pan } = churnTick(i, count, input.spanStart, input.spanEnd);
      scheduleTone(
        ctx,
        {
          freqHz,
          type: "square",
          peakGain: CHURN_TICK_PEAK_GAIN,
          pan,
          // Near-instant attack and a short decay: a strike, not a note.
          attackMs: 2,
          sustainMs: 2,
          releaseMs: CHURN_TICK_DURATION_MS - 4,
          // A square through a high-Q bandpass rings like struck glass.
          filter: { type: "bandpass", frequency: freqHz, q: CHURN_TICK_FILTER_Q },
          layer: "churn",
        },
        t0 + (i * CHURN_TICK_SPACING_MS) / 1000
      );
      scheduled++;
    }
  }

  // A burst that made no sound must not spend the rate limit, or the event the
  // user is actually waiting for arrives inside the window and is dropped.
  if (scheduled === 0) return "below-threshold";

  state.lastBurstAt = now;
  return "played";
}

// ---------------------------------------------------------------------------
// The observer
// ---------------------------------------------------------------------------

interface Pending {
  addedElements: number;
  textChanges: number;
  samples: Element[];
  points: SpatialPoint[];
}

function emptyPending(): Pending {
  return { addedElements: 0, textChanges: 0, samples: [], points: [] };
}

export interface MutationSonifierHandle {
  /**
   * Call from the index observer's `onIndexChanged`. An event that adds
   * entries flushes immediately — it has already waited out the index
   * observer's 150 ms debounce, and F-17 allows 250 ms in total.
   */
  onIndexChanged: (event: MutationEvent, index: ElementIndex) => void;
  disconnect: () => void;
  /** Tests only. */
  flushNow: (now?: number) => BurstOutcome;
}

export interface MutationSonifierOptions {
  doc?: Document;
  /** Tests only: observe this node instead of `document.body`. */
  target?: Node;
}

/**
 * Attach the sonifier. Safe to call on any page: every failure path leaves the
 * page untouched and the extension silent.
 */
export function startMutationSonification(
  options: MutationSonifierOptions = {}
): MutationSonifierHandle {
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  const state = { lastBurstAt: 0 };
  let pending = emptyPending();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let observer: MutationObserver | null = null;

  function flush(now = Date.now()): BurstOutcome {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const current = pending;
    pending = emptyPending();

    // Cheap gate before any layout read (see isWorthSonifying).
    if (
      !isWorthSonifying({
        points: current.points,
        addedElements: current.addedElements,
        textChanges: current.textChanges,
      })
    ) {
      return "below-threshold";
    }

    const geometry = measure(current, doc);
    return sonifyBurst(
      {
        points: current.points,
        weightedAdded: geometry.weightedAdded,
        addedElements: current.addedElements,
        textChanges: current.textChanges,
        spanStart: geometry.spanStart,
        spanEnd: geometry.spanEnd,
        centroidX: geometry.centroidX,
      },
      state,
      now
    );
  }

  function scheduleFlush(): void {
    // A trailing throttle, not a resetting debounce: a page that mutates
    // without pause would reset a debounce forever and never make a sound.
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, MUTATION_CHURN_DEBOUNCE_MS);
  }

  if (doc) {
    try {
      const target = options.target ?? doc.body ?? doc.documentElement;
      const Ctor = doc.defaultView?.MutationObserver ?? MutationObserver;
      observer = new Ctor((records: MutationRecord[]) => {
        // The hot path. Counting only.
        const limit = Math.min(records.length, MUTATION_RECORD_SCAN_CAP);
        for (let i = 0; i < limit; i++) {
          const record = records[i];
          // SPEC 12.9 step 4: our own overlays are not page activity.
          if (isOwnOverlay(record.target)) continue;

          if (record.type === "characterData") {
            pending.textChanges++;
            continue;
          }
          const added = record.addedNodes;
          for (let n = 0; n < added.length; n++) {
            const node = added[n];
            if (node.nodeType === 1) {
              const element = node as Element;
              if (isOwnOverlay(element)) continue;
              pending.addedElements++;
              if (pending.samples.length < MUTATION_GEOMETRY_SAMPLE_CAP) {
                pending.samples.push(element);
              }
            } else if (node.nodeType === 3) {
              pending.textChanges++;
            }
          }
        }
        scheduleFlush();
      });
      if (target) {
        observer.observe(target, { childList: true, subtree: true, characterData: true });
      }
    } catch {
      observer = null;
    }
  }

  return {
    onIndexChanged(event, index) {
      if (event.addedIds.length === 0) {
        // Nothing interactive arrived. Whatever changed is churn, and the
        // churn timer already owns it.
        return;
      }
      pending.points = selectPoints(event.addedIds, index);
      flush(event.at || Date.now());
    },
    disconnect() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      // Drop what was counted but never flushed. Anything still pending
      // describes a page this sonifier is no longer listening to.
      pending = emptyPending();
      observer?.disconnect();
      observer = null;
    },
    flushNow(now) {
      return flush(now);
    },
  };
}

/** True for our own overlays, which SPEC 12.9 step 4 keeps out of the diff. */
function isOwnOverlay(node: Node | null): boolean {
  if (!node) return false;
  const element =
    node.nodeType === 1 ? (node as Element) : (node.parentElement as Element | null);
  try {
    return element?.closest?.("[data-echo]") != null;
  } catch {
    return false;
  }
}

interface Geometry {
  weightedAdded: number;
  spanStart: number;
  spanEnd: number;
  centroidX: number;
}

/**
 * The only place that reads layout, and it runs at most once per flush.
 *
 * Horizontal extent comes from the index points when there are any — they
 * already carry SPEC 12.6 coordinates computed during the index build, so a
 * structural burst costs no layout at all. Only a churn-only burst, which has
 * no index entries to borrow from, pays for `getBoundingClientRect`, and then
 * for at most MUTATION_GEOMETRY_SAMPLE_CAP elements.
 */
function measure(pending: Pending, doc: Document | null): Geometry {
  const xs: number[] = pending.points.map((p) => p.x);
  let weightedAdded = pending.addedElements;

  if (pending.samples.length > 0) {
    // Subtree weighting: five cards each holding six nodes is a bigger event
    // than five bare buttons, and should sound like one. Sampled and averaged
    // rather than counted exhaustively, because the sample is capped at eight
    // and the added set is not.
    let subtreeTotal = 0;
    for (const element of pending.samples) {
      let descendants: number;
      try {
        descendants = Math.min(
          element.querySelectorAll?.("*").length ?? 0,
          MUTATION_SUBTREE_COUNT_CAP
        );
      } catch {
        descendants = 0;
      }
      subtreeTotal += 1 + descendants;

      if (xs.length === 0 && doc) {
        const x = normalizedCentreX(element, doc);
        if (x !== null) xs.push(x);
      }
    }
    const meanSubtree = subtreeTotal / pending.samples.length;
    weightedAdded = pending.addedElements * meanSubtree;
  }

  if (xs.length === 0) {
    // Nothing locatable: centre it. A sound with no position is better than no
    // sound, and better than a position that is a guess pretending otherwise.
    return { weightedAdded, spanStart: 0.5, spanEnd: 0.5, centroidX: 0.5 };
  }

  return {
    weightedAdded,
    spanStart: Math.min(...xs),
    spanEnd: Math.max(...xs),
    centroidX: xs.reduce((sum, x) => sum + x, 0) / xs.length,
  };
}

/** SPEC 12.6's horizontal coordinate, for an element the index never saw. */
function normalizedCentreX(element: Element, doc: Document): number | null {
  try {
    const rect = element.getBoundingClientRect?.();
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    const view = doc.defaultView;
    const scrollX = view?.scrollX ?? 0;
    const width = Math.max(doc.documentElement?.scrollWidth || 0, 1);
    return clamp01((rect.left + scrollX + rect.width / 2) / width);
  } catch {
    return null;
  }
}
