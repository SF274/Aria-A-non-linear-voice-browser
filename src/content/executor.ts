/**
 * Action Executor — T0-15 (F-07), SPEC sections 7.6.3, 12.8, 12.10, 16.
 *
 * Implements content script execution of one or more actions with per-action
 * re-resolution, visible/enabled checks, framework-compatible event dispatch,
 * and batch-abort semantics.
 */

import {
  type Action,
  type ElementIndex,
  type ElementIndexEntry,
  type ExecuteRequest,
  type ExecuteResult,
  type StepResult,
} from "../shared/contracts";
import { beginActivity, endActivity } from "./audio/engine";
import { playPositionalTick } from "./audio/transport";
import { highlightElement } from "./highlight";
import { buildElementIndex } from "./index-builder";
import { computeElementNameAndKey, reResolveElement } from "./reresolve";

export interface ExecutorOptions {
  doc?: Document;
  index?: ElementIndex;
  buildIndexFn?: (force?: boolean) => ElementIndex;
}

/**
 * Checks if an element is a password field (SPEC 7.6.3 step 2, R2.4).
 */
export function isElementPassword(el: Element): boolean {
  return el.tagName === "INPUT" && (el as HTMLInputElement).type?.toLowerCase() === "password";
}

/**
 * Checks if an element is enabled (SPEC 7.6.3 step 2).
 */
export function isElementEnabled(el: Element): boolean {
  const isAriaDisabled = el.getAttribute("aria-disabled")?.toLowerCase() === "true";
  const isDisabled =
    el.hasAttribute("disabled") ||
    ("disabled" in el && Boolean((el as HTMLElement & { disabled: boolean }).disabled)) ||
    el.closest("fieldset[disabled]") !== null;
  const isReadOnly =
    el.hasAttribute("readonly") ||
    ("readOnly" in el && Boolean((el as HTMLElement & { readOnly: boolean }).readOnly));
  return !isDisabled && !isAriaDisabled && !isReadOnly;
}

/**
 * Checks if an element is visible (SPEC 7.6.3 step 2, 12.5).
 */
export function isElementVisible(el: Element, win: Window): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  const cs = win.getComputedStyle(el);
  if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") {
    return false;
  }
  if (el.closest("[aria-hidden='true']")) {
    return false;
  }
  const checkVis = (
    el as unknown as {
      checkVisibility?: (opts?: { checkOpacity?: boolean; checkVisibilityCSS?: boolean }) => boolean;
    }
  ).checkVisibility;
  if (
    typeof checkVis === "function" &&
    checkVis.call(el, { checkOpacity: true, checkVisibilityCSS: true }) === false
  ) {
    return false;
  }
  return true;
}

/**
 * Checks if an element's bounding rect intersects the current viewport.
 */
export function isElementInViewport(el: Element, win: Window): boolean {
  const rect = el.getBoundingClientRect();
  const winW = win.innerWidth || el.ownerDocument.documentElement.clientWidth || 1024;
  const winH = win.innerHeight || el.ownerDocument.documentElement.clientHeight || 768;
  return rect.bottom > 0 && rect.top < winH && rect.right > 0 && rect.left < winW;
}

/**
 * Scrolls element into view if not already in viewport, waiting one requestAnimationFrame (SPEC 7.6.3 step 3).
 */
export async function ensureInViewport(el: Element, win: Window): Promise<void> {
  if (!isElementInViewport(el, win)) {
    if (typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "center", behavior: "instant" });
    }
    await new Promise<void>((resolve) => {
      if (typeof win.requestAnimationFrame === "function") {
        win.requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 16);
      }
    });
  }
}

/**
 * Finds the native property setter on the element's prototype chain.
 *
 * React (and every other framework with controlled inputs) shadows `value` and
 * `checked` on the *instance* to track what it last rendered. Assigning through
 * the instance updates that tracker, so the event we dispatch next looks like
 * "no change" and the framework silently drops the write. Going through the
 * prototype setter leaves the tracker stale, which is exactly what makes the
 * following event register as a real change. DEV-004 (fill), DEV-012 (checked).
 */
function nativePropertySetter(
  element: Element,
  prop: "value" | "checked"
): ((v: never) => void) | undefined {
  for (let proto = Object.getPrototypeOf(element); proto; proto = Object.getPrototypeOf(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
    if (descriptor?.set) {
      return descriptor.set as (v: never) => void;
    }
  }
  return undefined;
}

/**
 * Dispatches the pair of bubbling events a framework listens for after a
 * programmatic write: `input` first, then `change`, the order a real user
 * interaction produces.
 */
function dispatchInputAndChange(element: Element): void {
  let inputEvent: Event;
  try {
    inputEvent = new InputEvent("input", { bubbles: true, composed: true });
  } catch {
    inputEvent = new Event("input", { bubbles: true, composed: true });
  }
  element.dispatchEvent(inputEvent);
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Reads the current toggle state of a checkbox, radio, or ARIA switch.
 * Returns null when the element carries no toggle state at all.
 */
export function readCheckedState(element: Element): boolean | null {
  if ("checked" in element) {
    return Boolean((element as HTMLInputElement).checked);
  }
  const aria = element.getAttribute("aria-checked")?.toLowerCase();
  if (aria === "true") return true;
  if (aria === "false") return false;
  return null;
}

/**
 * Drives a toggle to `desired` without a blind click (HD-14, DEV-012).
 *
 * SPEC 7.6.3 step 6 says `check -> if !checked, element.click()`. A click is a
 * *relative* operation: it toggles whatever state the element is in. The caller
 * has already established that the current state differs from the desired one,
 * so the direction is known -- but on a React-controlled checkbox a click can
 * still land the wrong way round, because the DOM's `checked` and React's idea
 * of it can disagree at the moment the click arrives. Writing the state
 * absolutely removes the question.
 */
function setCheckedState(
  element: Element,
  desired: boolean
): { success: boolean; status?: StepResult["status"]; detail?: string } {
  if ("checked" in element) {
    const nativeSetter = nativePropertySetter(element, "checked");
    if (nativeSetter) {
      nativeSetter.call(element, desired as never);
    } else {
      (element as HTMLInputElement).checked = desired;
    }
    // Keep an explicit aria-checked, if the author wrote one, in step with the
    // property a screen reader would otherwise disagree with.
    if (element.hasAttribute("aria-checked")) {
      element.setAttribute("aria-checked", String(desired));
    }
    dispatchInputAndChange(element);
    return { success: true };
  }

  // A custom widget (role="switch" on a div, say) has no `checked` property to
  // write: its state lives in the page's own script, and a click is the only
  // way in. It is not a blind one -- the caller checked aria-checked first.
  (element as HTMLElement).click();
  return { success: true };
}

/**
 * Executes a single verb on the verified live element per SPEC 7.6.3 step 6.
 */
export function performVerb(
  verb: Action["verb"],
  element: Element,
  value?: string
): { success: boolean; status?: StepResult["status"]; detail?: string } {
  const htmlEl = element as HTMLElement;

  switch (verb) {
    case "click":
      // MASTER RULE: click must use element.click(). Do NOT dispatch MouseEvent with coordinates.
      htmlEl.click();
      return { success: true };

    case "focus":
      htmlEl.focus({ preventScroll: true });
      return { success: true };

    case "fill": {
      htmlEl.focus({ preventScroll: true });
      const fillVal = value ?? "";

      // Write through the native prototype setter, found up the chain, then
      // dispatch `input` and `change`. See nativePropertySetter for why the
      // instance property is the wrong way in (DEV-004).
      const nativeSetter = nativePropertySetter(element, "value");
      if (nativeSetter) {
        nativeSetter.call(element, fillVal as never);
      } else {
        (element as HTMLInputElement | HTMLTextAreaElement).value = fillVal;
      }

      dispatchInputAndChange(element);
      // Give the keyboard back. A field left focused swallows the next hold-to-talk
      // press as typing (SPEC 6.1), so after a voice fill the user could not speak
      // again without clicking away. Blur also commits blur-validated forms.
      htmlEl.blur();
      return { success: true };
    }

    case "select": {
      if (element.tagName.toLowerCase() !== "select" && !(element instanceof HTMLSelectElement)) {
        return {
          success: false,
          status: "not_found",
          detail: "Target element is not a <select>",
        };
      }
      const selectEl = element as HTMLSelectElement;
      const targetVal = (value ?? "").trim().toLowerCase();
      let matchedIndex = -1;

      for (let i = 0; i < selectEl.options.length; i++) {
        const opt = selectEl.options[i];
        const optText = (opt.text || opt.textContent || "").trim().toLowerCase();
        const optVal = (opt.value || "").trim().toLowerCase();
        if (optText === targetVal || optVal === targetVal) {
          matchedIndex = i;
          break;
        }
      }

      if (matchedIndex === -1) {
        return {
          success: false,
          status: "not_found",
          detail: `No option matching value "${value}" found`,
        };
      }

      selectEl.selectedIndex = matchedIndex;
      selectEl.value = selectEl.options[matchedIndex].value;
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
      return { success: true };
    }

    // `check` and `uncheck` name an absolute state, not a toggle (HD-14). Each
    // one is a no-op when the element is already in that state, and otherwise
    // writes the state it names -- never a click, whose direction depends on
    // what the element currently is.
    case "check":
    case "uncheck": {
      const desired = verb === "check";
      const current = readCheckedState(element);
      if (current === desired) {
        // Already there. The user asked for a state, and the state holds: the
        // step succeeded, and touching the element could only undo it.
        return { success: true };
      }
      return setCheckedState(element, desired);
    }

    case "scrollTo":
      if (typeof element.scrollIntoView === "function") {
        element.scrollIntoView({ block: "center", behavior: "instant" });
      }
      return { success: true };

    default:
      return {
        success: false,
        status: "error",
        detail: `Unknown verb "${String(verb)}"`,
      };
  }
}

/**
 * Resolves the active ElementIndex to validate against.
 */
function resolveCurrentIndex(
  doc: Document,
  options?: ExecutorOptions
): ElementIndex {
  if (options?.index) {
    return options.index;
  }
  if (typeof options?.buildIndexFn === "function") {
    return options.buildIndexFn();
  }
  if (typeof window !== "undefined" && typeof window.__ECHO_GET_INDEX__ === "function") {
    return window.__ECHO_GET_INDEX__();
  }
  return buildElementIndex(doc);
}

/**
 * Executes an ExecuteRequest on the current document per SPEC 7.6.3, 12.8, and 12.10.
 *
 * @param request The ExecuteRequest to run
 * @param options Context options (doc, index, buildIndexFn)
 * @returns ExecuteResult indicating success or failure point
 */
export async function executeRequest(
  request: ExecuteRequest,
  options?: ExecutorOptions
): Promise<ExecuteResult> {
  // SPEC 9.8 step 5: while a batch is running, its positional ticks are the
  // answer to what the user asked for. The DOM changes the batch itself causes
  // must not sonify underneath them. The window closes as soon as the batch
  // does, so the page's *response* — results loading in after a click — is
  // still heard.
  beginActivity("batch");
  try {
    return await runRequest(request, options);
  } finally {
    endActivity("batch");
  }
}

async function runRequest(
  request: ExecuteRequest,
  options?: ExecutorOptions
): Promise<ExecuteResult> {
  const doc = options?.doc || (typeof document !== "undefined" ? document : null);
  if (!doc) {
    return {
      ok: false,
      completed: 0,
      failedAtIndex: 0,
      results: [
        {
          index: 0,
          verb: request.actions[0]?.verb || "click",
          elementId: request.actions[0]?.elementId || "",
          resolvedName: null,
          status: "error",
          detail: "No document available for execution",
        },
      ],
    };
  }

  const win = doc.defaultView || (typeof window !== "undefined" ? window : null);
  if (!win) {
    return {
      ok: false,
      completed: 0,
      failedAtIndex: 0,
      results: [
        {
          index: 0,
          verb: request.actions[0]?.verb || "click",
          elementId: request.actions[0]?.elementId || "",
          resolvedName: null,
          status: "error",
          detail: "No window available for execution",
        },
      ],
    };
  }

  // 1. Validate buildId against current index (SPEC 12.9, 12.10, 16 F-07)
  const currentIndex = resolveCurrentIndex(doc, options);
  if (currentIndex.buildId !== request.buildId) {
    return {
      ok: false,
      completed: 0,
      failedAtIndex: 0,
      results: [
        {
          index: 0,
          verb: request.actions[0]?.verb || "click",
          elementId: request.actions[0]?.elementId || "",
          resolvedName: null,
          status: "rejected",
          detail: `buildId mismatch: request "${request.buildId}" !== current "${currentIndex.buildId}"`,
        },
      ],
    };
  }

  if (!request.actions || request.actions.length === 0) {
    return {
      ok: true,
      completed: 0,
      failedAtIndex: null,
      results: [],
    };
  }

  const results: StepResult[] = [];

  // Execute each action sequentially
  for (let i = 0; i < request.actions.length; i++) {
    const action = request.actions[i];

    // Find the original target entry in the index
    const targetEntry: ElementIndexEntry | undefined = currentIndex.entries.find(
      (e) => e.id === action.elementId
    );

    if (!targetEntry) {
      results.push({
        index: i,
        verb: action.verb,
        elementId: action.elementId,
        resolvedName: null,
        status: "not_found",
        detail: `elementId "${action.elementId}" not found in current index`,
      });
      return {
        ok: false,
        completed: i,
        failedAtIndex: i,
        results,
      };
    }

    // Step 1: Re-resolve immediately before acting (SPEC 12.8)
    const liveElement = reResolveElement(targetEntry, doc);
    if (!liveElement) {
      results.push({
        index: i,
        verb: action.verb,
        elementId: action.elementId,
        // The intended target's indexed name, so the spoken partial-failure
        // sentence can name the step that failed (SPEC 6.12).
        resolvedName: targetEntry.name,
        status: "not_found",
        detail: "Element not found during re-resolution",
      });
      return {
        ok: false,
        completed: i,
        failedAtIndex: i,
        results,
      };
    }

    // Step 2: Verify live element is still visible, enabled, and not password-type
    const visible = isElementVisible(liveElement, win);
    const enabled = isElementEnabled(liveElement);
    const password = isElementPassword(liveElement);

    if (!visible || !enabled || password) {
      const reasons: string[] = [];
      if (!visible) reasons.push("not visible");
      if (!enabled) reasons.push("disabled");
      if (password) reasons.push("password");

      results.push({
        index: i,
        verb: action.verb,
        elementId: action.elementId,
        resolvedName: targetEntry.name,
        status: "not_actionable",
        detail: `Element is not actionable (${reasons.join(", ")})`,
      });
      return {
        ok: false,
        completed: i,
        failedAtIndex: i,
        results,
      };
    }

    // Step 3: Scroll into view if not in viewport, wait one rAF
    await ensureInViewport(liveElement, win);

    // Step 4: Apply highlight for 400 ms (non-blocking)
    highlightElement(liveElement, 400);

    // Step 5: Positional tick if playTicks. Fire and forget: audio trouble
    // must never delay or prevent the action (SPEC 9.6).
    if (request.playTicks) {
      void playPositionalTick({ x: targetEntry.x, y: targetEntry.y, role: targetEntry.role });
    }
    // Step 6: Perform verb
    const outcome = performVerb(action.verb, liveElement, action.value);

    if (!outcome.success) {
      results.push({
        index: i,
        verb: action.verb,
        elementId: action.elementId,
        resolvedName: targetEntry.name,
        status: outcome.status || "error",
        detail: outcome.detail,
      });
      return {
        ok: false,
        completed: i,
        failedAtIndex: i,
        results,
      };
    }

    const liveName = computeElementNameAndKey(liveElement).name || targetEntry.name;
    results.push({
      index: i,
      verb: action.verb,
      elementId: action.elementId,
      resolvedName: liveName,
      status: "ok",
    });

    // Step 7: Wait stepDelayMs before the next action
    if (i < request.actions.length - 1 && request.stepDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, request.stepDelayMs));
    }
  }

  return {
    ok: true,
    completed: results.length,
    failedAtIndex: null,
    results,
  };
}
