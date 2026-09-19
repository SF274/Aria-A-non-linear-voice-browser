/**
 * Visual Highlight Overlay — T0-17 (F-09), SPEC sections 6.11, 9.9, 16.
 *
 * SPEC 9.9: Class-based highlighting via an injected stylesheet.
 * SPEC 9.9 / F-09: Never mutate inline styles.
 * SPEC 9.9 / F-09: All highlight classes cleared on IDLE.
 */

export const OVERLAY_CSS = `
.echo-highlight {
  outline: 3px solid #FFB020 !important;
  outline-offset: 2px !important;
  box-shadow: 0 0 0 6px rgba(255, 176, 32, 0.25) !important;
  transition: none !important;
}
.echo-candidate {
  outline-color: #3B82F6 !important;
}
`.trim();

const STYLE_DATA_ATTR = "data-echo";
const STYLE_DATA_VALUE = "highlight-styles";

/** Track active timeouts so clearHighlights can cancel pending removals. */
const activeTimers = new Set<ReturnType<typeof setTimeout>>();

/**
 * Injects the highlight stylesheet into document.head if not already present.
 * Tagged with [data-echo="highlight-styles"] so index-builder ignores it (SPEC 12.2 exclusion 6).
 */
export function injectHighlightStyles(doc: Document = document): HTMLStyleElement {
  const existing = doc.querySelector<HTMLStyleElement>(
    `style[${STYLE_DATA_ATTR}="${STYLE_DATA_VALUE}"]`
  );
  if (existing) {
    return existing;
  }

  const styleEl = doc.createElement("style");
  styleEl.setAttribute(STYLE_DATA_ATTR, STYLE_DATA_VALUE);
  styleEl.textContent = OVERLAY_CSS;

  const target = doc.head || doc.documentElement;
  target.appendChild(styleEl);
  return styleEl;
}

/**
 * Applies the .echo-highlight class to an element for durationMs (default 400 ms per SPEC 6.11, 16 F-09).
 * Preserves inline styles without any modification.
 * Returns a cancel/cleanup function.
 */
export function highlightElement(
  element: Element,
  durationMs = 400
): () => void {
  if (!element || !(element instanceof Element)) {
    return () => {};
  }

  injectHighlightStyles(element.ownerDocument || document);

  element.classList.add("echo-highlight");

  let timer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      activeTimers.delete(timer);
      timer = null;
    }
    element.classList.remove("echo-highlight");
  };

  timer = setTimeout(() => {
    cleanup();
  }, durationMs);

  activeTimers.add(timer);

  return cleanup;
}

/**
 * Highlights a set of candidate elements simultaneously with .echo-highlight and .echo-candidate
 * for disambiguation/clarification (SPEC 7.5.1, 9.9).
 * Returns a cleanup function that clears candidate highlights.
 */
export function highlightCandidates(elements: Element[]): () => void {
  if (!elements || elements.length === 0) {
    return () => {};
  }

  const doc = elements[0].ownerDocument || document;
  injectHighlightStyles(doc);

  for (const el of elements) {
    if (el instanceof Element) {
      el.classList.add("echo-highlight", "echo-candidate");
    }
  }

  return () => {
    for (const el of elements) {
      if (el instanceof Element) {
        el.classList.remove("echo-highlight", "echo-candidate");
      }
    }
  };
}

/**
 * Clears all active highlight and candidate classes across the entire document
 * and cancels any pending highlight timers (SPEC 9.9, F-09 transition to IDLE).
 */
export function clearHighlights(doc: Document = document): void {
  // Cancel all scheduled timers
  for (const timer of activeTimers) {
    clearTimeout(timer);
  }
  activeTimers.clear();

  // Remove classes from any matching elements
  const highlighted = doc.querySelectorAll(".echo-highlight, .echo-candidate");
  for (const el of highlighted) {
    el.classList.remove("echo-highlight", "echo-candidate");
  }
}
