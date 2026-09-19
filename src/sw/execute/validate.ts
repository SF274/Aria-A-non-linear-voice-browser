/**
 * Pre-Dispatch Action Validation — T0-14 (F-07), SPEC sections 7.6.1, 7.6.2, 8.3.
 *
 * Implements all nine validation rules in SPEC 7.6.1 and the verb/role validity
 * table in SPEC 7.6.2. Enforces batch-abort semantics: a single invalid action
 * rejects the entire batch so zero actions are executed.
 */

import {
  type Action,
  type ElementIndex,
  type ElementIndexEntry,
  type ExecuteRequest,
  type Verb,
  ELEMENT_ID_PATTERN,
  VERBS,
} from "../../shared/contracts";

// eslint-disable-next-line no-control-regex -- SPEC 7.6.1 rule 7: control characters C0 and C1 (\u0000-\u001f, \u007f-\u009f)
const CONTROL_CHARS_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

/** Spoken phrase on validation refusal per SPEC 7.6.1 [REQUIREMENT]. */
export const VALIDATION_REFUSAL_PHRASE = "I couldn't do that safely.";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  rule?: number;
  invalidIndex?: number;
}

/**
 * Checks if a verb is in the closed enum of valid verbs (SPEC 7.6.1 rule 1).
 */
export function isValidVerb(verb: unknown): verb is Verb {
  return typeof verb === "string" && (VERBS as readonly string[]).includes(verb);
}

/**
 * Validates whether a verb is permissible for the target element's role per SPEC 7.6.2.
 *
 * | Verb | Valid roles |
 * | click | button, link, checkbox, radio, tab, menuitem, option, switch, combobox |
 * | fill | textbox, searchbox, spinbutton, combobox (when backed by input/textarea) |
 * | select | combobox, listbox (when backed by <select>) |
 * | check | checkbox, switch, radio |
 * | uncheck | checkbox, switch (uncheck invalid for radio) |
 * | scrollTo | any |
 * | focus | any focusable |
 */
export function isValidVerbForRole(verb: Verb, entry: ElementIndexEntry): boolean {
  const role = entry.role.toLowerCase();
  const tag = entry.tag.toLowerCase();

  switch (verb) {
    case "click":
      return [
        "button",
        "link",
        "checkbox",
        "radio",
        "tab",
        "menuitem",
        "option",
        "switch",
        "combobox",
      ].includes(role);

    case "fill":
      if (["textbox", "searchbox", "spinbutton"].includes(role)) {
        return true;
      }
      if (role === "combobox") {
        return tag === "input" || tag === "textarea";
      }
      return false;

    case "select":
      if (["combobox", "listbox"].includes(role)) {
        return tag === "select";
      }
      return false;

    case "check":
      return ["checkbox", "switch", "radio"].includes(role);

    case "uncheck":
      // SPEC 7.6.2 explicitly: "uncheck invalid for radio"
      return ["checkbox", "switch"].includes(role);

    case "scrollTo":
      return true;

    case "focus":
      // All indexed elements are focusable interactive elements
      return true;

    default:
      return false;
  }
}

/**
 * Validates a single action against an ElementIndex and expected buildId.
 * Checks rules 1 through 8 from SPEC 7.6.1.
 */
export function validateAction(
  action: Action,
  actionIndex: number,
  index: ElementIndex,
  expectedBuildId: string
): ValidationResult {
  // Rule 1: verb is in the closed enum
  if (!isValidVerb(action.verb)) {
    return {
      valid: false,
      rule: 1,
      invalidIndex: actionIndex,
      reason: `Rule 1: Invalid verb "${String((action as unknown as { verb: unknown }).verb)}"`,
    };
  }

  // Rule 2: elementId matches /^el_\d{1,3}$/
  if (typeof action.elementId !== "string" || !ELEMENT_ID_PATTERN.test(action.elementId)) {
    return {
      valid: false,
      rule: 2,
      invalidIndex: actionIndex,
      reason: `Rule 2: elementId "${String(action.elementId)}" does not match pattern /^el_\\d{1,3}$/`,
    };
  }

  // Rule 3: elementId is present in the index with buildId equal to ExecuteRequest.buildId
  if (index.buildId !== expectedBuildId) {
    return {
      valid: false,
      rule: 3,
      invalidIndex: actionIndex,
      reason: `Rule 3: buildId mismatch (request: "${expectedBuildId}", index: "${index.buildId}")`,
    };
  }

  const entry = index.entries.find((e) => e.id === action.elementId);
  if (!entry) {
    return {
      valid: false,
      rule: 3,
      invalidIndex: actionIndex,
      reason: `Rule 3: elementId "${action.elementId}" not found in index build "${expectedBuildId}"`,
    };
  }

  // Rule 4: The target entry has enabled === true
  if (entry.enabled !== true) {
    return {
      valid: false,
      rule: 4,
      invalidIndex: actionIndex,
      reason: `Rule 4: Target entry "${action.elementId}" is disabled (enabled === false)`,
    };
  }

  // Rule 5: The target entry has isPassword === false
  if (entry.isPassword !== false) {
    return {
      valid: false,
      rule: 5,
      invalidIndex: actionIndex,
      reason: `Rule 5: Target entry "${action.elementId}" is a password field (isPassword === true)`,
    };
  }

  // Rule 6: value is present if and only if verb is fill or select
  const requiresValue = action.verb === "fill" || action.verb === "select";
  const hasValue = action.value !== undefined && action.value !== null;
  if (requiresValue && !hasValue) {
    return {
      valid: false,
      rule: 6,
      invalidIndex: actionIndex,
      reason: `Rule 6: value property is required for verb "${action.verb}"`,
    };
  }
  if (!requiresValue && hasValue) {
    return {
      valid: false,
      rule: 6,
      invalidIndex: actionIndex,
      reason: `Rule 6: value property is forbidden for verb "${action.verb}"`,
    };
  }

  // Rule 7: value, when present, is <= 200 characters and contains no control characters
  if (hasValue && typeof action.value === "string") {
    if (action.value.length > 200) {
      return {
        valid: false,
        rule: 7,
        invalidIndex: actionIndex,
        reason: `Rule 7: value length ${action.value.length} exceeds 200 characters`,
      };
    }
    if (CONTROL_CHARS_PATTERN.test(action.value)) {
      return {
        valid: false,
        rule: 7,
        invalidIndex: actionIndex,
        reason: "Rule 7: value contains forbidden control characters",
      };
    }
  }

  // Rule 8: The verb is valid for the target role (SPEC 7.6.2)
  if (!isValidVerbForRole(action.verb, entry)) {
    return {
      valid: false,
      rule: 8,
      invalidIndex: actionIndex,
      reason: `Rule 8: Verb "${action.verb}" is not valid for target role "${entry.role}" (tag: "${entry.tag}")`,
    };
  }

  return { valid: true };
}

/**
 * Validates an ExecuteRequest before dispatching to the content script.
 *
 * Implements SPEC 7.6.1 rules 1-9:
 * If ANY action fails, the entire batch is rejected with zero actions executed.
 */
export function validateExecuteRequest(
  request: ExecuteRequest,
  index: ElementIndex
): ValidationResult {
  // Rule 9: actions.length is between 1 and 5
  if (!request.actions || request.actions.length < 1 || request.actions.length > 5) {
    return {
      valid: false,
      rule: 9,
      reason: `Rule 9: actions length must be between 1 and 5 (received ${request.actions?.length ?? 0})`,
    };
  }

  for (let i = 0; i < request.actions.length; i++) {
    const action = request.actions[i];
    const result = validateAction(action, i, index, request.buildId);
    if (!result.valid) {
      return result;
    }
  }

  return { valid: true };
}
