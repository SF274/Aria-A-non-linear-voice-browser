/**
 * Element Index Builder — T0-05 (F-04), SPEC sections 5.1, 5.2, 12.1-12.7.
 */

import { computeAccessibleName } from "dom-accessibility-api";
import { type ARIARoleDefinitionKey, elementRoles, roles } from "aria-query";

import {
  type ElementIndex,
  type ElementIndexEntry,
  ElementIndexSchema,
  ELEMENT_NAME_MAX_CHARS,
  ELEMENT_VALUE_MAX_CHARS,
  PAGE_TITLE_MAX_CHARS,
} from "../shared/contracts";
import { MAX_INDEX } from "../shared/constants";
import { normalizeNameKey } from "../shared/normalize";

/**
 * SPEC 12.2: The selector union for all interactive elements to consider.
 */
export const INDEX_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[role=button]",
  "[role=link]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=switch]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=combobox]",
  "[role=listbox]",
  "[role=searchbox]",
  "[role=textbox]",
  "[role=spinbutton]",
  "[role=option]",
  "[role=slider]",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** Roles that can retain an index entry even if computed accessible name is empty (SPEC 12.2 exclusion 3). */
const UNLABELLED_ALLOWED_ROLES = new Set([
  "textbox",
  "searchbox",
  "combobox",
  "spinbutton",
]);

/**
 * SPEC 8.4: Sanitize page-controlled strings before prompt construction.
 * 1. Strip C0 and C1 control characters
 * 2. Collapse whitespace runs to a single space
 * 3. Truncate to maximum length
 * 4. Strip <page_elements>, </page_elements>, <user_command>, </user_command> case-insensitively
 * 5. Trim
 */
export function sanitizeForPrompt(s: string, maxLength?: number): string {
  if (!s) return "";
  // 1. Strip C0 and C1 control characters: \u0000-\u001f, \u007f-\u009f
  // eslint-disable-next-line no-control-regex -- SPEC 8.4 rule 1 requires stripping C0 and C1 control characters
  let res = s.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  // 2. Collapse all whitespace runs to a single space
  res = res.replace(/\s+/g, " ");
  // 3. Truncate to maxLength
  if (typeof maxLength === "number" && maxLength > 0) {
    res = res.slice(0, maxLength);
  }
  // 4. Strip tag delimiters case-insensitively
  res = res.replace(/<\/?page_elements>|<\/?user_command>/gi, "");
  // 5. Collapse whitespace again and trim
  res = res.replace(/\s+/g, " ").trim();
  // Ensure length constraint holds after trimming
  if (typeof maxLength === "number" && maxLength > 0 && res.length > maxLength) {
    res = res.slice(0, maxLength).trim();
  }
  return res;
}

/**
 * Resolves an element's ARIA role per SPEC 12.3:
 * Explicit role (first valid token) -> implicit role from aria-query -> "generic".
 */
export function resolveRole(el: Element): string {
  // 1. Explicit role attribute
  const rawRole = el.getAttribute("role");
  if (rawRole) {
    for (const token of rawRole.trim().split(/\s+/)) {
      const lower = token.toLowerCase();
      if (roles.has(lower as ARIARoleDefinitionKey)) {
        return lower;
      }
    }
  }

  // 2. Implicit role from aria-query
  const tag = el.tagName.toLowerCase();
  let bestRole: string | null = null;
  let maxSpecificity = -1;

  for (const [concept, roleList] of elementRoles.entries()) {
    if (concept.name !== tag) continue;
    let matches = true;
    let specificity = 0;

    if (concept.attributes) {
      for (const attr of concept.attributes) {
        specificity += 10;
        const attrVal = el.getAttribute(attr.name);
        const rawConstraints = (attr.constraints || []) as unknown as string[];
        if (rawConstraints.includes("set")) {
          if (!el.hasAttribute(attr.name)) {
            matches = false;
            break;
          }
        } else if (rawConstraints.includes("undefined")) {
          if (attr.name === "type") {
            if (
              el.hasAttribute("type") &&
              el.getAttribute("type")?.toLowerCase() !== "text"
            ) {
              matches = false;
              break;
            }
          } else if (el.hasAttribute(attr.name)) {
            matches = false;
            break;
          }
        } else if (rawConstraints.includes(">1")) {
          if (Number(attrVal) <= 1) {
            matches = false;
            break;
          }
        } else if (attr.value !== undefined) {
          const effectiveVal =
            attr.name === "type" && !el.hasAttribute("type")
              ? "text"
              : attrVal;
          if (String(effectiveVal).toLowerCase() !== String(attr.value).toLowerCase()) {
            matches = false;
            break;
          }
          specificity += 5;
        } else {
          if (!el.hasAttribute(attr.name)) {
            matches = false;
            break;
          }
        }
      }
    }

    if (!matches) continue;

    if (concept.constraints) {
      for (const rawConstraint of concept.constraints as unknown as string[]) {
        if (
          rawConstraint === "the list attribute is not set" &&
          el.hasAttribute("list")
        ) {
          matches = false;
          break;
        }
        if (
          rawConstraint ===
          "the multiple attribute is not set and the size attribute does not have a value greater than 1"
        ) {
          if (el.hasAttribute("multiple") || Number(el.getAttribute("size")) > 1) {
            matches = false;
            break;
          }
        }
        if (rawConstraint === "the size attribute value is greater than 1") {
          if (Number(el.getAttribute("size")) <= 1) {
            matches = false;
            break;
          }
        }
      }
    }

    if (!matches) continue;

    if (specificity > maxSpecificity) {
      maxSpecificity = specificity;
      const rolesArray = Array.from(roleList as Iterable<string>);
      bestRole = rolesArray[0] || null;
    }
  }

  return bestRole?.toLowerCase() || "generic";
}

/**
 * Clamps a number to [0, 1].
 */
function clamp01(v: number): number {
  if (isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/**
 * Generates a UUID v4 string.
 */
function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Builds the page element index per SPEC 12.
 *
 * @param doc The Document to index (defaults to window.document)
 * @returns Validated ElementIndex
 */
export function buildElementIndex(doc?: Document): ElementIndex {
  const documentNode = doc || (typeof document !== "undefined" ? document : null);
  if (!documentNode) {
    throw new Error("No document available for element index build");
  }

  const win = documentNode.defaultView || (typeof window !== "undefined" ? window : null);
  if (!win) {
    throw new Error("No window available for element index build");
  }

  const scrollWidth = Math.max(documentNode.documentElement.scrollWidth || 0, 1);
  const scrollHeight = Math.max(documentNode.documentElement.scrollHeight || 0, 1);
  const scrollX = win.scrollX ?? (win as Window & { pageXOffset?: number }).pageXOffset ?? 0;
  const scrollY = win.scrollY ?? (win as Window & { pageYOffset?: number }).pageYOffset ?? 0;
  const winW = win.innerWidth || documentNode.documentElement.clientWidth || 1024;
  const winH = win.innerHeight || documentNode.documentElement.clientHeight || 768;

  const rawElements = Array.from(documentNode.querySelectorAll(INDEX_SELECTOR));
  const candidateEntries: ElementIndexEntry[] = [];

  for (const el of rawElements) {
    // Exclusion 1: input[type=hidden]
    if (
      el.tagName === "INPUT" &&
      (el as HTMLInputElement).type?.toLowerCase() === "hidden"
    ) {
      continue;
    }

    // Exclusion 2: Failing visibility test (SPEC 12.5)
    // Visibility is computed only once per index build
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      continue;
    }

    const cs = win.getComputedStyle(el);
    if (
      cs.visibility === "hidden" ||
      cs.display === "none" ||
      cs.opacity === "0"
    ) {
      continue;
    }

    if (el.closest("[aria-hidden='true']")) {
      continue;
    }

    const checkVis = (
      el as unknown as {
        checkVisibility?: (options?: {
          checkOpacity?: boolean;
          checkVisibilityCSS?: boolean;
        }) => boolean;
      }
    ).checkVisibility;
    if (
      typeof checkVis === "function" &&
      checkVis.call(el, { checkOpacity: true, checkVisibilityCSS: true }) === false
    ) {
      continue;
    }

    // Role resolution
    const role = resolveRole(el);

    // Compute accessible name & fallback chain (SPEC 12.4)
    let rawName = "";
    try {
      rawName = computeAccessibleName(el);
    } catch {
      // Ignored: fallback chain used below
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

    // Exclusion 3: Empty accessible name AND role not in textbox, searchbox, combobox, spinbutton
    if (!name && !UNLABELLED_ALLOWED_ROLES.has(role)) {
      continue;
    }

    // Exclusion 4: Inside [aria-hidden="true"] (checked above, reaffirmed here per order)
    if (el.closest("[aria-hidden='true']")) {
      continue;
    }

    // Exclusion 5: Inside closed <details> (except when part of summary)
    const details = el.closest("details");
    if (details && !details.open) {
      const summary = el.closest("summary");
      if (!summary || summary.parentElement !== details) {
        continue;
      }
    }

    // Exclusion 6: Extension's own overlay elements
    if (el.closest("[data-echo]")) {
      continue;
    }

    // Coordinates (SPEC 12.6)
    const absCx = rect.left + scrollX + rect.width / 2;
    const absCy = rect.top + scrollY + rect.height / 2;
    const rawX = clamp01(absCx / scrollWidth);
    const rawY = clamp01(absCy / scrollHeight);
    const x = Math.round(rawX * 10000) / 10000;
    const y = Math.round(rawY * 10000) / 10000;
    const inViewport =
      rect.bottom > 0 &&
      rect.top < winH &&
      rect.right > 0 &&
      rect.left < winW;

    const isAriaDisabled = el.getAttribute("aria-disabled")?.toLowerCase() === "true";
    const isDisabled =
      el.hasAttribute("disabled") ||
      ("disabled" in el && Boolean((el as HTMLElement & { disabled: boolean }).disabled)) ||
      el.closest("fieldset[disabled]") !== null;
    const isReadOnly =
      el.hasAttribute("readonly") ||
      ("readOnly" in el && Boolean((el as HTMLElement & { readOnly: boolean }).readOnly));
    const enabled = !isDisabled && !isAriaDisabled && !isReadOnly;

    // Tag and input details
    const tag = el.tagName.toLowerCase();
    const isPassword =
      tag === "input" && (el as HTMLInputElement).type?.toLowerCase() === "password";
    const inputType =
      tag === "input" ? (el as HTMLInputElement).type?.toLowerCase() || "text" : null;

    // Value extraction (null for passwords)
    let value: string | null = null;
    if (!isPassword && (tag === "input" || tag === "textarea" || tag === "select")) {
      const rawValue = (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
      if (rawValue !== undefined && rawValue !== null && rawValue !== "") {
        value = sanitizeForPrompt(rawValue, ELEMENT_VALUE_MAX_CHARS);
      }
    }

    const nameKey = normalizeNameKey(name);

    candidateEntries.push({
      id: `el_${candidateEntries.length}`,
      role,
      name,
      nameKey,
      x,
      y,
      enabled,
      visible: true,
      inViewport,
      value,
      tag,
      inputType,
      isPassword,
    });
  }

  const truncated = candidateEntries.length > MAX_INDEX;
  const entries = candidateEntries.slice(0, MAX_INDEX);

  const rawTitle = documentNode.title || "";
  const title = sanitizeForPrompt(rawTitle, PAGE_TITLE_MAX_CHARS);

  const rawUrl = win.location?.href || "";

  const index: ElementIndex = {
    buildId: generateUuid(),
    url: rawUrl,
    title,
    builtAt: Date.now(),
    viewportW: winW,
    viewportH: winH,
    docH: scrollHeight,
    entries,
    truncated,
  };

  return ElementIndexSchema.parse(index);
}
