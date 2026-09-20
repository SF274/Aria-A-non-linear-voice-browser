/**
 * Mutation observer and index invalidation — T0-05 (F-04), SPEC section 12.9.
 */

import {
  type ElementIndex,
  type ElementIndexEntry,
  type Envelope,
  ENVELOPE_NS,
  type MutationEvent,
  MutationEventSchema,
} from "../shared/contracts";
import { buildElementIndex } from "./index-builder";

export const INITIAL_DEBOUNCE_MS = 150;
export const RUNAWAY_DEBOUNCE_MS = 1000;
export const RUNAWAY_RATE_LIMIT_PER_SEC = 5;
export const RUNAWAY_CONSECUTIVE_SECONDS = 3;

/**
 * Attributes that trigger a rebuild when changed (SPEC 12.9 step 1).
 */
export const OBSERVED_ATTRIBUTES = [
  "disabled",
  "aria-disabled",
  "aria-hidden",
  "hidden",
  "aria-label",
  "aria-labelledby",
  "value",
  "checked",
] as const;

/**
 * Computes addedIds and removedIds by comparing (role, nameKey) pairs
 * between previous and new index entries (SPEC 12.9 step 3).
 */
export function computeIndexDiff(
  prevEntries: ElementIndexEntry[],
  newEntries: ElementIndexEntry[]
): { addedIds: string[]; removedIds: string[] } {
  const prevMap = new Map<string, string[]>();
  for (const entry of prevEntries) {
    const key = `${entry.role}:${entry.nameKey}`;
    const list = prevMap.get(key) || [];
    list.push(entry.id);
    prevMap.set(key, list);
  }

  const newMap = new Map<string, string[]>();
  for (const entry of newEntries) {
    const key = `${entry.role}:${entry.nameKey}`;
    const list = newMap.get(key) || [];
    list.push(entry.id);
    newMap.set(key, list);
  }

  const addedIds: string[] = [];
  const removedIds: string[] = [];

  for (const [key, newIds] of newMap.entries()) {
    const prevIds = prevMap.get(key) || [];
    if (newIds.length > prevIds.length) {
      addedIds.push(...newIds.slice(prevIds.length));
    }
  }

  for (const [key, prevIds] of prevMap.entries()) {
    const newIds = newMap.get(key) || [];
    if (prevIds.length > newIds.length) {
      removedIds.push(...prevIds.slice(newIds.length));
    }
  }

  return { addedIds, removedIds };
}

export interface IndexObserverOptions {
  debounceMs?: number;
  initialIndex?: ElementIndex;
  doc?: Document;
  onIndexChanged?: (event: MutationEvent, newIndex: ElementIndex) => void;
}

export interface IndexObserverHandle {
  disconnect: () => void;
  getCurrentIndex: () => ElementIndex;
  rebuildNow: () => { event: MutationEvent; newIndex: ElementIndex };
  getDebounceMs: () => number;
}

/**
 * Creates and starts a MutationObserver monitoring document.body per SPEC 12.9.
 */
export function createIndexObserver(
  options: IndexObserverOptions = {}
): IndexObserverHandle {
  const doc =
    options.doc || (typeof document !== "undefined" ? document : null);
  if (!doc) {
    throw new Error("No document available for mutation observer");
  }
  const targetDoc: Document = doc;

  let currentIndex = options.initialIndex || buildElementIndex(targetDoc);
  let debounceMs = options.debounceMs ?? INITIAL_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Runaway guard tracking: map of epochSecond -> rebuild count
  const secondBuckets = new Map<number, number>();

  function checkRunawayGuard(now: number): void {
    const currentSecond = Math.floor(now / 1000);
    const count = (secondBuckets.get(currentSecond) || 0) + 1;
    secondBuckets.set(currentSecond, count);

    // Prune buckets older than 5 seconds
    for (const sec of secondBuckets.keys()) {
      if (sec < currentSecond - 5) {
        secondBuckets.delete(sec);
      }
    }

    // Check if current and past 2 seconds all exceeded RUNAWAY_RATE_LIMIT_PER_SEC
    const s0 = secondBuckets.get(currentSecond) || 0;
    const s1 = secondBuckets.get(currentSecond - 1) || 0;
    const s2 = secondBuckets.get(currentSecond - 2) || 0;

    if (
      s0 > RUNAWAY_RATE_LIMIT_PER_SEC &&
      s1 > RUNAWAY_RATE_LIMIT_PER_SEC &&
      s2 > RUNAWAY_RATE_LIMIT_PER_SEC
    ) {
      if (debounceMs < RUNAWAY_DEBOUNCE_MS) {
        debounceMs = RUNAWAY_DEBOUNCE_MS;
        console.warn(
          "[Aria] Runaway mutation guard triggered: rebuilds exceeded 5/s for 3 consecutive seconds; debounce increased to 1000 ms"
        );
      }
    }
  }

  function executeRebuild(): { event: MutationEvent; newIndex: ElementIndex } {
    const now = Date.now();
    checkRunawayGuard(now);

    const prevIndex = currentIndex;
    const newIndex = buildElementIndex(targetDoc);
    currentIndex = newIndex;

    const { addedIds, removedIds } = computeIndexDiff(
      prevIndex.entries,
      newIndex.entries
    );

    const rawEvent: MutationEvent = {
      buildId: newIndex.buildId,
      addedIds,
      removedIds,
      at: now,
    };

    const event = MutationEventSchema.parse(rawEvent);

    // Emit message to service worker if running in extension runtime
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      const envelope: Envelope<MutationEvent> = {
        ns: ENVELOPE_NS,
        target: "sw",
        type: "index.changed",
        reqId:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : String(now),
        payload: event,
      };
      try {
        chrome.runtime.sendMessage(envelope);
      } catch {
        // Ignored if service worker is inactive
      }
    }

    options.onIndexChanged?.(event, newIndex);

    return { event, newIndex };
  }

  const observer = new (doc.defaultView?.MutationObserver || MutationObserver)(
    (mutations: MutationRecord[]) => {
      // SPEC 12.9 step 4: Ignore mutations originating inside [data-echo]
      const hasExternalMutation = mutations.some((record) => {
        const target = record.target;
        if (target instanceof Element) {
          if (target.closest("[data-echo]")) return false;
        } else if (target.parentElement) {
          if (target.parentElement.closest("[data-echo]")) return false;
        }
        return true;
      });

      if (!hasExternalMutation) {
        return;
      }

      if (timer) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => {
        timer = null;
        executeRebuild();
      }, debounceMs);
    }
  );

  const targetNode = doc.body || doc.documentElement;
  if (targetNode) {
    observer.observe(targetNode, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [...OBSERVED_ATTRIBUTES],
    });
  }

  return {
    disconnect() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      observer.disconnect();
    },
    getCurrentIndex() {
      return currentIndex;
    },
    rebuildNow() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return executeRebuild();
    },
    getDebounceMs() {
      return debounceMs;
    },
  };
}
