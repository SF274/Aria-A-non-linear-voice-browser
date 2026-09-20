/**
 * Clarification — SPEC 7.5.1 (question formation) and 7.5.2 (reply resolution).
 */

import { describe, expect, it } from "vitest";

import type { ElementIndexEntry } from "../../src/shared/contracts";
import {
  formatClarifyingQuestion,
  inDocumentOrder,
  resolveClarificationReply,
  verbForClarifiedTarget,
} from "../../src/sw/resolver/clarify";

function entry(over: Partial<ElementIndexEntry> & Pick<ElementIndexEntry, "id" | "name">): ElementIndexEntry {
  return {
    role: "button",
    nameKey: over.name.toLowerCase(),
    x: 0.5,
    y: 0.5,
    enabled: true,
    visible: true,
    inViewport: true,
    value: null,
    tag: "button",
    inputType: null,
    isPassword: false,
    ...over,
  };
}

// The demo page's two identical Download buttons (HD-06): same name, same region.
const dlPdf = entry({ id: "el_30", name: "Download", x: 0.4, y: 0.96 });
const dlWord = entry({ id: "el_31", name: "Download", x: 0.6, y: 0.96 });

describe("formatClarifyingQuestion (SPEC 7.5.1)", () => {
  it("level 1: uses the distinguishing tokens when every candidate has one", () => {
    const q = formatClarifyingQuestion([
      entry({ id: "el_1", name: "Download PDF" }),
      entry({ id: "el_2", name: "Download Word" }),
    ]);
    expect(q).toBe("PDF or Word?");
  });

  it("level 2: falls back to regions when names are identical but positions differ", () => {
    const q = formatClarifyingQuestion([
      entry({ id: "el_1", name: "Download", x: 0.1, y: 0.5 }),
      entry({ id: "el_2", name: "Download", x: 0.9, y: 0.95 }),
    ]);
    expect(q).toBe("The one on the left or the one at the bottom?");
  });

  it("level 3: falls back to ordinals for the demo page's identical Download buttons", () => {
    expect(formatClarifyingQuestion([dlPdf, dlWord])).toBe("The first one or the second one?");
  });

  it("lists three and four candidates and stays within 90 characters", () => {
    const four = ["el_1", "el_2", "el_3", "el_4"].map((id) => entry({ id, name: "Save", y: 0.95 }));
    const q = formatClarifyingQuestion(four);
    expect(q).toBe("The first one, the second one, the third one, or the fourth one?");
    expect(q.length).toBeLessThanOrEqual(90);
  });

  it("orders ordinals by document order, not by the order candidates were passed", () => {
    expect(inDocumentOrder([dlWord, dlPdf]).map((c) => c.id)).toEqual(["el_30", "el_31"]);
    expect(formatClarifyingQuestion([dlWord, dlPdf])).toBe("The first one or the second one?");
  });
});

describe("resolveClarificationReply (SPEC 7.5.2)", () => {
  const candidates = [dlWord, dlPdf]; // deliberately out of order

  it.each([
    ["the first one", "el_30"],
    ["first", "el_30"],
    ["the second one", "el_31"],
    ["Second.", "el_31"],
    ["2nd", "el_31"],
    ["the last one", "el_31"],
  ])("ordinal reply %j resolves to %s", (reply, id) => {
    const r = resolveClarificationReply(reply, candidates);
    expect(r.kind).toBe("resolved");
    if (r.kind === "resolved") expect(r.entry.id).toBe(id);
  });

  it("an ordinal beyond the candidate count is unresolved", () => {
    expect(resolveClarificationReply("the fourth one", candidates).kind).toBe("unresolved");
  });

  it("positional replies pick by coordinate", () => {
    const r = resolveClarificationReply("the left one", candidates);
    expect(r.kind === "resolved" && r.entry.id).toBe("el_30");
    const r2 = resolveClarificationReply("the right one", candidates);
    expect(r2.kind === "resolved" && r2.entry.id).toBe("el_31");
  });

  it("a positional reply is unresolved when the candidates share that coordinate", () => {
    const stacked = [entry({ id: "el_1", name: "Save", x: 0.5, y: 0.2 }), entry({ id: "el_2", name: "Save", x: 0.5, y: 0.8 })];
    expect(resolveClarificationReply("the left one", stacked).kind).toBe("unresolved");
    expect(resolveClarificationReply("the bottom one", stacked).kind).toBe("resolved");
  });

  it("a name reply is scored against the candidates only, with the lowered threshold", () => {
    const named = [entry({ id: "el_1", name: "Download PDF" }), entry({ id: "el_2", name: "Download Word" })];
    const r = resolveClarificationReply("word", named);
    expect(r.kind === "resolved" && r.entry.id).toBe("el_2");
  });

  it("an unrelated reply is unresolved", () => {
    expect(resolveClarificationReply("banana", candidates).kind).toBe("unresolved");
  });

  it("a name that matches both candidates equally is unresolved rather than guessed", () => {
    expect(resolveClarificationReply("download", candidates).kind).toBe("unresolved");
  });
});

describe("verbForClarifiedTarget (HD-14)", () => {
  const box = entry({ id: "el_5", name: "Non-stop only", role: "checkbox", tag: "input" });
  const button = entry({ id: "el_10", name: "Search flights" });
  const field = entry({ id: "el_7", name: "From", role: "textbox", tag: "input" });

  it("acts on the clarified box with the verb the command named", () => {
    expect(verbForClarifiedTarget(box, "uncheck")).toBe("uncheck");
    expect(verbForClarifiedTarget(box, "check")).toBe("check");
  });

  it("falls back to the SPEC 7.2.2 default when the command named no verb", () => {
    expect(verbForClarifiedTarget(box)).toBe("click");
    expect(verbForClarifiedTarget(button)).toBe("click");
    expect(verbForClarifiedTarget(field)).toBe("focus");
  });

  it("discards a pinned verb the chosen candidate cannot take (SPEC 7.6.2)", () => {
    // "Uncheck one of these" answered with a button: uncheck is invalid there,
    // and refusing the whole batch would be a worse answer than pressing it.
    expect(verbForClarifiedTarget(button, "uncheck")).toBe("click");
    expect(verbForClarifiedTarget(button, "fill")).toBe("click");
    // `fill` and `select` need a value, and the reply carries none: SPEC 7.6.1
    // rule 6 would refuse the batch. Focus the field and let the user retype.
    expect(verbForClarifiedTarget(field, "fill")).toBe("focus");
    expect(verbForClarifiedTarget(field, "scrollTo")).toBe("scrollTo");
    // A radio cannot be unchecked at all (SPEC 7.6.2).
    const radio = entry({ id: "el_9", name: "Economy", role: "radio", tag: "input" });
    expect(verbForClarifiedTarget(radio, "uncheck")).toBe("click");
    expect(verbForClarifiedTarget(radio, "check")).toBe("check");
  });
});
