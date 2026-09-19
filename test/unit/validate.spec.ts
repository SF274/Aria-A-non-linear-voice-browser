import { describe, expect, it } from "vitest";

import {
  type Action,
  type ElementIndex,
  type ElementIndexEntry,
  type ExecuteRequest,
} from "../../src/shared/contracts";
import {
  isValidVerb,
  isValidVerbForRole,
  validateAction,
  validateExecuteRequest,
} from "../../src/sw/execute/validate";

function createMockEntry(overrides: Partial<ElementIndexEntry> = {}): ElementIndexEntry {
  return {
    id: "el_0",
    role: "button",
    name: "Submit",
    nameKey: "submit",
    x: 0.5,
    y: 0.5,
    enabled: true,
    visible: true,
    inViewport: true,
    value: null,
    tag: "button",
    inputType: null,
    isPassword: false,
    ...overrides,
  };
}

function createMockIndex(entries: ElementIndexEntry[] = [createMockEntry()]): ElementIndex {
  return {
    buildId: "test-build-123",
    url: "http://localhost/test",
    title: "Test Page",
    builtAt: 1000,
    viewportW: 1024,
    viewportH: 768,
    docH: 768,
    entries,
    truncated: false,
  };
}

describe("Pre-Dispatch Action Validation (SPEC 7.6.1, 7.6.2, T0-14)", () => {
  const index = createMockIndex([
    createMockEntry({ id: "el_0", role: "button", tag: "button", enabled: true }),
    createMockEntry({ id: "el_1", role: "textbox", tag: "input", inputType: "text", enabled: true }),
    createMockEntry({ id: "el_2", role: "combobox", tag: "select", enabled: true }),
    createMockEntry({ id: "el_3", role: "combobox", tag: "input", inputType: "text", enabled: true }),
    createMockEntry({ id: "el_4", role: "checkbox", tag: "input", inputType: "checkbox", enabled: true }),
    createMockEntry({ id: "el_5", role: "radio", tag: "input", inputType: "radio", enabled: true }),
    createMockEntry({ id: "el_6", role: "button", tag: "button", enabled: false }),
    createMockEntry({ id: "el_7", role: "textbox", tag: "input", isPassword: true, enabled: true }),
    createMockEntry({ id: "el_8", role: "link", tag: "a", enabled: true }),
    createMockEntry({ id: "el_9", role: "switch", tag: "button", enabled: true }),
  ]);

  it("Rule 1: rejects an action with a verb not in the closed enum", () => {
    expect(isValidVerb("navigate")).toBe(false);
    expect(isValidVerb("hover")).toBe(false);
    expect(isValidVerb("click")).toBe(true);

    const invalidAction = {
      verb: "navigate" as unknown as Action["verb"],
      elementId: "el_0",
    } as Action;

    const res = validateAction(invalidAction, 0, index, index.buildId);
    expect(res.valid).toBe(false);
    expect(res.rule).toBe(1);
    expect(res.reason).toContain("Invalid verb");
  });

  it("Rule 2: rejects an elementId that does not match /^el_\\d{1,3}$/", () => {
    const invalidIds = ["btn_1", "el_", "el_1234", "0", "el_abc", ""];
    for (const badId of invalidIds) {
      const action: Action = {
        verb: "click",
        elementId: badId,
      };
      const res = validateAction(action, 0, index, index.buildId);
      expect(res.valid).toBe(false);
      expect(res.rule).toBe(2);
      expect(res.reason).toContain("does not match pattern");
    }
  });

  it("Rule 3: rejects if elementId is not present in index", () => {
    const action: Action = {
      verb: "click",
      elementId: "el_99",
    };
    const res = validateAction(action, 0, index, index.buildId);
    expect(res.valid).toBe(false);
    expect(res.rule).toBe(3);
    expect(res.reason).toContain("not found in index");
  });

  it("Rule 3: rejects if buildId does not match ExecuteRequest.buildId", () => {
    const action: Action = {
      verb: "click",
      elementId: "el_0",
    };
    const res = validateAction(action, 0, index, "stale-build-999");
    expect(res.valid).toBe(false);
    expect(res.rule).toBe(3);
    expect(res.reason).toContain("buildId mismatch");
  });

  it("Rule 4: rejects if target entry has enabled === false", () => {
    const action: Action = {
      verb: "click",
      elementId: "el_6", // disabled
    };
    const res = validateAction(action, 0, index, index.buildId);
    expect(res.valid).toBe(false);
    expect(res.rule).toBe(4);
    expect(res.reason).toContain("enabled === false");
  });

  it("Rule 5: rejects if target entry has isPassword === true", () => {
    const action: Action = {
      verb: "fill",
      elementId: "el_7", // password
      value: "secret",
    };
    const res = validateAction(action, 0, index, index.buildId);
    expect(res.valid).toBe(false);
    expect(res.rule).toBe(5);
    expect(res.reason).toContain("password field");
  });

  it("Rule 6: rejects if value is missing for fill or select", () => {
    const actionFill: Action = {
      verb: "fill",
      elementId: "el_1",
    };
    const resFill = validateAction(actionFill, 0, index, index.buildId);
    expect(resFill.valid).toBe(false);
    expect(resFill.rule).toBe(6);
    expect(resFill.reason).toContain("value property is required");

    const actionSelect: Action = {
      verb: "select",
      elementId: "el_2",
    };
    const resSelect = validateAction(actionSelect, 0, index, index.buildId);
    expect(resSelect.valid).toBe(false);
    expect(resSelect.rule).toBe(6);
    expect(resSelect.reason).toContain("value property is required");
  });

  it("Rule 6: rejects if value is present for verbs other than fill or select", () => {
    const actionClick: Action = {
      verb: "click",
      elementId: "el_0",
      value: "unnecessary",
    };
    const res = validateAction(actionClick, 0, index, index.buildId);
    expect(res.valid).toBe(false);
    expect(res.rule).toBe(6);
    expect(res.reason).toContain("value property is forbidden");
  });

  it("Rule 7: rejects if value exceeds 200 characters", () => {
    const action: Action = {
      verb: "fill",
      elementId: "el_1",
      value: "a".repeat(201),
    };
    const res = validateAction(action, 0, index, index.buildId);
    expect(res.valid).toBe(false);
    expect(res.rule).toBe(7);
    expect(res.reason).toContain("exceeds 200 characters");
  });

  it("Rule 7: rejects if value contains control characters", () => {
    const controlChars = ["\u0000", "\u0007", "\u001b", "\u007f", "\u009f"];
    for (const char of controlChars) {
      const action: Action = {
        verb: "fill",
        elementId: "el_1",
        value: `hello${char}world`,
      };
      const res = validateAction(action, 0, index, index.buildId);
      expect(res.valid).toBe(false);
      expect(res.rule).toBe(7);
      expect(res.reason).toContain("control characters");
    }
  });

  it("Rule 8: enforces SPEC 7.6.2 verb / role validity table", () => {
    // click valid for: button, link, checkbox, radio, tab, menuitem, option, switch, combobox
    expect(isValidVerbForRole("click", createMockEntry({ role: "button" }))).toBe(true);
    expect(isValidVerbForRole("click", createMockEntry({ role: "link" }))).toBe(true);
    expect(isValidVerbForRole("click", createMockEntry({ role: "textbox" }))).toBe(false);

    // fill valid for: textbox, searchbox, spinbutton, combobox (when backed by input/textarea)
    expect(isValidVerbForRole("fill", createMockEntry({ role: "textbox", tag: "input" }))).toBe(true);
    expect(isValidVerbForRole("fill", createMockEntry({ role: "searchbox", tag: "input" }))).toBe(true);
    expect(isValidVerbForRole("fill", createMockEntry({ role: "spinbutton", tag: "input" }))).toBe(true);
    expect(isValidVerbForRole("fill", createMockEntry({ role: "combobox", tag: "input" }))).toBe(true);
    expect(isValidVerbForRole("fill", createMockEntry({ role: "combobox", tag: "textarea" }))).toBe(true);
    expect(isValidVerbForRole("fill", createMockEntry({ role: "combobox", tag: "select" }))).toBe(false);
    expect(isValidVerbForRole("fill", createMockEntry({ role: "button", tag: "button" }))).toBe(false);

    // select valid for: combobox, listbox (when backed by <select>)
    expect(isValidVerbForRole("select", createMockEntry({ role: "combobox", tag: "select" }))).toBe(true);
    expect(isValidVerbForRole("select", createMockEntry({ role: "listbox", tag: "select" }))).toBe(true);
    expect(isValidVerbForRole("select", createMockEntry({ role: "combobox", tag: "input" }))).toBe(false);
    expect(isValidVerbForRole("select", createMockEntry({ role: "textbox", tag: "input" }))).toBe(false);

    // check valid for: checkbox, switch, radio
    expect(isValidVerbForRole("check", createMockEntry({ role: "checkbox" }))).toBe(true);
    expect(isValidVerbForRole("check", createMockEntry({ role: "switch" }))).toBe(true);
    expect(isValidVerbForRole("check", createMockEntry({ role: "radio" }))).toBe(true);
    expect(isValidVerbForRole("check", createMockEntry({ role: "button" }))).toBe(false);

    // uncheck valid for: checkbox, switch; INVALID for radio
    expect(isValidVerbForRole("uncheck", createMockEntry({ role: "checkbox" }))).toBe(true);
    expect(isValidVerbForRole("uncheck", createMockEntry({ role: "switch" }))).toBe(true);
    expect(isValidVerbForRole("uncheck", createMockEntry({ role: "radio" }))).toBe(false);

    // scrollTo and focus valid for any
    expect(isValidVerbForRole("scrollTo", createMockEntry({ role: "button" }))).toBe(true);
    expect(isValidVerbForRole("scrollTo", createMockEntry({ role: "textbox" }))).toBe(true);
    expect(isValidVerbForRole("focus", createMockEntry({ role: "button" }))).toBe(true);
    expect(isValidVerbForRole("focus", createMockEntry({ role: "link" }))).toBe(true);

    // validateAction with invalid role
    const uncheckRadio: Action = {
      verb: "uncheck",
      elementId: "el_5", // radio
    };
    const res = validateAction(uncheckRadio, 0, index, index.buildId);
    expect(res.valid).toBe(false);
    expect(res.rule).toBe(8);
    expect(res.reason).toContain("not valid for target role");
  });

  it("Rule 9: rejects an actions array with length < 1 or > 5", () => {
    const emptyReq: ExecuteRequest = {
      buildId: index.buildId,
      actions: [] as unknown as Action[],
      stepDelayMs: 0,
      playTicks: false,
    };
    const resEmpty = validateExecuteRequest(emptyReq, index);
    expect(resEmpty.valid).toBe(false);
    expect(resEmpty.rule).toBe(9);

    const sixActionsReq: ExecuteRequest = {
      buildId: index.buildId,
      actions: Array.from({ length: 6 }, () => ({
        verb: "click",
        elementId: "el_0",
      })),
      stepDelayMs: 0,
      playTicks: false,
    };
    const resSix = validateExecuteRequest(sixActionsReq, index);
    expect(resSix.valid).toBe(false);
    expect(resSix.rule).toBe(9);
  });

  it("Batch-abort semantics: a batch containing one invalid action rejects the whole batch", () => {
    const mixedBatch: ExecuteRequest = {
      buildId: index.buildId,
      actions: [
        { verb: "click", elementId: "el_0" },
        { verb: "fill", elementId: "el_1", value: "Valid Name" },
        { verb: "uncheck", elementId: "el_5" }, // INVALID: uncheck on radio
        { verb: "click", elementId: "el_8" },
      ],
      stepDelayMs: 50,
      playTicks: false,
    };

    const res = validateExecuteRequest(mixedBatch, index);
    expect(res.valid).toBe(false);
    expect(res.rule).toBe(8);
    expect(res.invalidIndex).toBe(2);
  });

  it("passes validation for valid single action and valid 5-action batch", () => {
    const validSingle: ExecuteRequest = {
      buildId: index.buildId,
      actions: [{ verb: "click", elementId: "el_0" }],
      stepDelayMs: 0,
      playTicks: false,
    };
    expect(validateExecuteRequest(validSingle, index).valid).toBe(true);

    const validFive: ExecuteRequest = {
      buildId: index.buildId,
      actions: [
        { verb: "click", elementId: "el_0" },
        { verb: "fill", elementId: "el_1", value: "Toronto" },
        { verb: "select", elementId: "el_2", value: "Economy" },
        { verb: "check", elementId: "el_4" },
        { verb: "focus", elementId: "el_8" },
      ],
      stepDelayMs: 100,
      playTicks: false,
    };
    expect(validateExecuteRequest(validFive, index).valid).toBe(true);
  });
});
