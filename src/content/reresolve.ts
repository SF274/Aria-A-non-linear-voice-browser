/**
 * Immediate Re-resolution — T0-15 (F-07), SPEC sections 12.8, 12.10.
 *
 * SPEC 12.8 [REQUIREMENT]: The content script does not hold DOM node references
 * across the resolve-execute boundary. Immediately before each individual action
 * (not once per batch), the content script re-finds the live element in the DOM.
 */

import { computeAccessibleName } from "dom-accessibility-api";

import {
  type ElementIndexEntry,
  ELEMENT_NAME_MAX_CHARS,
} from "../shared/contracts";
import { normalizeNameKey } from "../shared/normalize";
import {
  INDEX_SELECTOR,
  resolveRole,
  sanitizeForPrompt,
} from "./index-builder";

/** Movement threshold in normalized units per SPEC 12.8 step 4 and SPEC 12.10. */
export const MAX_MOVEMENT_DISTANCE = 0.15;

/**
 * Computes an element's accessible name and normalized nameKey using the same
 * rules as index-builder.ts.
 */
export function computeElementNameAndKey(el: Element): { name: string; nameKey: string } {
  let rawName = "";
  try {
    rawName = computeAccessibleName(el, { hidden: true });
  } catch {
    // Fallback chain per SPEC 12.4
  }

  if (!rawName) {
    rawName =
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      el.getAttribute("name") ||
      (el.tagName === "INPUT" ? (el as HTMLInputElement).type || "" : "") ||
      "";
  }

  const name = sanitizeForPrompt(rawName, ELEMENT_NAME_MAX_CHARS);
  const nameKey = normalizeNameKey(name);
  return { name, nameKey };
}

/**
 * Computes an element's current document-relative normalized centre coordinates (0..1).
 */
export function computeElementCoordinates(
  el: Element,
  doc: Document = el.ownerDocument || document
): { x: number; y: number } {
  const win = doc.defaultView || (typeof window !== "undefined" ? window : null);
  const scrollWidth = Math.max(doc.documentElement?.scrollWidth || 0, 1);
  const scrollHeight = Math.max(doc.documentElement?.scrollHeight || 0, 1);
  const scrollX = win ? (win.scrollX ?? (win as Window & { pageXOffset?: number }).pageXOffset ?? 0) : 0;
  const scrollY = win ? (win.scrollY ?? (win as Window & { pageYOffset?: number }).pageYOffset ?? 0) : 0;

  const rect = el.getBoundingClientRect();
  const absCx = rect.left + scrollX + rect.width / 2;
  const absCy = rect.top + scrollY + rect.height / 2;

  const rawX = Math.max(0, Math.min(1, absCx / scrollWidth));
  const rawY = Math.max(0, Math.min(1, absCy / scrollHeight));
  const x = Math.round(rawX * 10000) / 10000;
  const y = Math.round(rawY * 10000) / 10000;
  return { x, y };
}

/**
 * Re-finds the live element for a target index entry immediately before acting on it.
 *
 * SPEC 12.8:
 * 1. Re-run the index selector query.
 * 2. Filter to elements whose computed role === entry.role
 *    and whose normalized accessible name === entry.nameKey.
 * 3. If exactly one -> use it.
 * 4. If more than one -> choose the one whose current document-relative centre
 *    is nearest to entry.(x,y). If the nearest is > 0.15 normalized units away,
 *    treat as not found.
 * 5. If zero -> not found.
 *
 * @param entry The indexed entry to match against
 * @param doc The Document context (defaults to window.document)
 * @returns The matching live Element, or null if not found
 */
export function reResolveElement(
  entry: ElementIndexEntry,
  doc: Document = document
): Element | null {
  if (!doc || !entry) return null;

  // 1. Re-run index selector query
  const rawElements = Array.from(doc.querySelectorAll(INDEX_SELECTOR));

  // 2. Filter to elements whose computed role === entry.role and normalized accessible name === entry.nameKey
  const matches: Element[] = [];

  for (const el of rawElements) {
    // Exclude extension overlay and hidden inputs
    if (el.closest("[data-echo]")) continue;
    if (el.tagName === "INPUT" && (el as HTMLInputElement).type?.toLowerCase() === "hidden") {
      continue;
    }

    const computedRole = resolveRole(el);
    if (computedRole !== entry.role) {
      continue;
    }

    const { nameKey } = computeElementNameAndKey(el);
    if (nameKey !== entry.nameKey) {
      continue;
    }

    matches.push(el);
  }

  // 3. If exactly one -> use it, unless it has moved too far. SPEC 12.10
  //    ("Element moved more than 0.15 normalized units: treat as not_found")
  //    applies to a lone match as well: acting on a moved element is how a
  //    voice interface clicks the wrong thing.
  if (matches.length === 1) {
    const coords = computeElementCoordinates(matches[0], doc);
    const distance = Math.hypot(coords.x - entry.x, coords.y - entry.y);
    return distance <= MAX_MOVEMENT_DISTANCE ? matches[0] : null;
  }

  // 4. If more than one -> choose nearest. If nearest > 0.15 units away, return null
  if (matches.length > 1) {
    let nearestEl: Element | null = null;
    let minDistance = Infinity;

    for (const el of matches) {
      const coords = computeElementCoordinates(el, doc);
      const distance = Math.hypot(coords.x - entry.x, coords.y - entry.y);
      if (distance < minDistance) {
        minDistance = distance;
        nearestEl = el;
      }
    }

    if (nearestEl && minDistance <= MAX_MOVEMENT_DISTANCE) {
      return nearestEl;
    }
    return null;
  }

  // 5. If zero -> not found
  return null;
}
