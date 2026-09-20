import { describe, expect, it } from "vitest";

import commandsData from "../fixtures/commands.json";
import {
  type ElementIndex,
  type ElementIndexEntry,
} from "../../src/shared/contracts";
import {
  LOCAL_AMBIGUOUS_FLOOR,
  LOCAL_CONFIDENT_THRESHOLD,
  LOCAL_MARGIN,
  MAX_CLARIFY_CANDIDATES,
  MIN_CLARIFY_CANDIDATES,
} from "../../src/shared/constants";
import { normalizeNameKey } from "../../src/shared/normalize";
import {
  isValidVerbForRole,
  levenshteinRatio,
  matchesRoleHint,
  scoreCandidate,
  tokenSetRatio,
} from "../../src/sw/resolver/score";
import { resolveLocal } from "../../src/sw/resolver/local";

/**
 * Creates a synthetic ElementIndex representing the 25 controls from the demo page
 * specified in SPEC 15 (4 nav, 3 filters, 4 search, 5 flights, 7 booking, 2 download).
 */
function createDemoIndex(): ElementIndex {
  const rawControls: Array<{
    id: string;
    role: string;
    name: string;
    tag?: string;
    inputType?: string;
    enabled?: boolean;
    inViewport?: boolean;
  }> = [
    // SPEC 15.3 — Navigation (4 anchors)
    { id: "el_0", role: "link", name: "Home", tag: "a" },
    { id: "el_1", role: "link", name: "Flights", tag: "a" },
    { id: "el_2", role: "link", name: "Check-in", tag: "a" },
    { id: "el_3", role: "link", name: "Help", tag: "a" },

    // SPEC 15.4 — Sidebar filters (3 checkboxes)
    { id: "el_4", role: "checkbox", name: "Morning departures", tag: "input", inputType: "checkbox" },
    { id: "el_5", role: "checkbox", name: "Non-stop only", tag: "input", inputType: "checkbox" },
    { id: "el_6", role: "checkbox", name: "Refundable fares", tag: "input", inputType: "checkbox" },

    // SPEC 15.5 — Search bar (4 controls)
    { id: "el_7", role: "textbox", name: "From", tag: "input", inputType: "text" },
    { id: "el_8", role: "textbox", name: "To", tag: "input", inputType: "text" },
    { id: "el_9", role: "textbox", name: "Departure date", tag: "input", inputType: "text" },
    { id: "el_10", role: "button", name: "Search flights", tag: "button" },

    // SPEC 15.6 — Flight results (5 unique flight buttons)
    { id: "el_11", role: "button", name: "Select 6:15 AM flight", tag: "button" },
    { id: "el_12", role: "button", name: "Select 9:40 AM flight", tag: "button" },
    { id: "el_13", role: "button", name: "Select 1:05 PM flight", tag: "button" },
    { id: "el_14", role: "button", name: "Select 4:30 PM flight", tag: "button" },
    { id: "el_15", role: "button", name: "Select 8:55 PM flight", tag: "button" },

    // SPEC 15.7 — Booking form (7 controls)
    { id: "el_16", role: "textbox", name: "Passenger name", tag: "input", inputType: "text" },
    { id: "el_17", role: "textbox", name: "Email address", tag: "input", inputType: "email" },
    { id: "el_18", role: "combobox", name: "Seat preference", tag: "select" },
    { id: "el_19", role: "radio", name: "Use saved card ending 4417", tag: "input", inputType: "radio" },
    { id: "el_20", role: "radio", name: "Use a new card", tag: "input", inputType: "radio" },
    { id: "el_21", role: "checkbox", name: "I accept the fare rules", tag: "input", inputType: "checkbox" },
    { id: "el_22", role: "button", name: "Confirm booking", tag: "button" },

    // SPEC 15.9 — Duplicate download buttons (both named "Download")
    { id: "el_23", role: "button", name: "Download", tag: "button" }, // PDF button
    { id: "el_24", role: "button", name: "Download", tag: "button" }, // Word button
  ];

  const entries: ElementIndexEntry[] = rawControls.map((c, idx) => ({
    id: c.id,
    role: c.role,
    name: c.name,
    nameKey: normalizeNameKey(c.name),
    x: 0.5,
    y: 0.05 + idx * 0.035,
    enabled: c.enabled ?? true,
    visible: true,
    inViewport: c.inViewport ?? true,
    value: null,
    tag: c.tag ?? "button",
    inputType: c.inputType ?? null,
    isPassword: false,
  }));

  return {
    buildId: "test-build-demo",
    url: "http://localhost:5174/",
    title: "Flight Search Demo",
    builtAt: Date.now(),
    viewportW: 1024,
    viewportH: 768,
    docH: 1200,
    entries,
    truncated: false,
  };
}

describe("Local Scorer — score.ts (SPEC 7.2.3, 7.6.2)", () => {
  it("levenshteinRatio calculates exact similarity", () => {
    expect(levenshteinRatio("flights", "flights")).toBe(1.0);
    expect(levenshteinRatio("", "")).toBe(1.0);
    expect(levenshteinRatio("abc", "xyz")).toBe(0.0);
    expect(levenshteinRatio("", "abc")).toBe(0.0);
    expect(levenshteinRatio("search", "search flights")).toBeGreaterThan(0.5);
  });

  it("tokenSetRatio handles exact matches, subsets, and permutations", () => {
    // Exact match
    expect(tokenSetRatio("search flights", "search flights")).toBe(1.0);

    // Order insensitivity
    expect(tokenSetRatio("flights search", "search flights")).toBe(1.0);

    // Subset match: "search" in "search flights" has strong partial similarity
    expect(tokenSetRatio("search", "search flights")).toBeGreaterThanOrEqual(0.6);

    // Non-overlapping strings
    expect(tokenSetRatio("make me a sandwich", "search flights")).toBeLessThan(0.4);
  });

  it("isValidVerbForRole enforces SPEC 7.6.2 validity rules", () => {
    expect(isValidVerbForRole("click", "button")).toBe(true);
    expect(isValidVerbForRole("click", "link")).toBe(true);
    expect(isValidVerbForRole("click", "textbox")).toBe(false);

    expect(isValidVerbForRole("fill", "textbox")).toBe(true);
    expect(isValidVerbForRole("fill", "button")).toBe(false);

    expect(isValidVerbForRole("check", "checkbox")).toBe(true);
    expect(isValidVerbForRole("check", "radio")).toBe(true);

    expect(isValidVerbForRole("uncheck", "checkbox")).toBe(true);
    expect(isValidVerbForRole("uncheck", "radio")).toBe(false); // uncheck invalid for radio

    expect(isValidVerbForRole("scrollTo", "button")).toBe(true);
    expect(isValidVerbForRole("focus", "button")).toBe(true);
  });

  it("matchesRoleHint maps role hints to role classes per SPEC 7.2.3", () => {
    expect(matchesRoleHint("button", "button")).toBe(true);
    expect(matchesRoleHint("button", "link")).toBe(true);
    expect(matchesRoleHint("button", "textbox")).toBe(false);

    expect(matchesRoleHint("link", "link")).toBe(true);
    expect(matchesRoleHint("link", "button")).toBe(false);

    expect(matchesRoleHint("field", "textbox")).toBe(true);
    expect(matchesRoleHint("field", "searchbox")).toBe(true);
    expect(matchesRoleHint("field", "combobox")).toBe(true);
    expect(matchesRoleHint("field", "spinbutton")).toBe(true);
    expect(matchesRoleHint("field", "button")).toBe(false);

    expect(matchesRoleHint("box", "checkbox")).toBe(true);
    expect(matchesRoleHint("box", "radio")).toBe(true);
    expect(matchesRoleHint("box", "button")).toBe(false);
  });

  it("scoreCandidate computes all positive boosts, penalties, and clamps to [0, 1]", () => {
    const entry: ElementIndexEntry = {
      id: "el_1",
      role: "button",
      name: "Search flights",
      nameKey: "search flights",
      x: 0.5,
      y: 0.5,
      enabled: true,
      visible: true,
      inViewport: true,
      value: null,
      tag: "button",
      inputType: null,
      isPassword: false,
    };

    const breakdown = scoreCandidate("search flights", entry, {
      roleHint: "button",
      parsedVerb: "click",
    });

    expect(breakdown.base).toBe(1.0);
    expect(breakdown.prefixBoost).toBe(0.05);
    expect(breakdown.roleBoost).toBe(0.08);
    expect(breakdown.verbBoost).toBe(0.05);
    expect(breakdown.viewBoost).toBe(0.03);
    expect(breakdown.disabledPenalty).toBe(0);
    expect(breakdown.total).toBe(1.0); // Clamped to 1.0

    // Test disabled penalty (-0.50)
    const disabledEntry: ElementIndexEntry = {
      ...entry,
      enabled: false,
    };
    const disabledBreakdown = scoreCandidate("search flights", disabledEntry);
    expect(disabledBreakdown.disabledPenalty).toBe(-0.5);
    expect(disabledBreakdown.total).toBeLessThanOrEqual(0.6);
  });
});

describe("Local Resolver — local.ts & Gate IG-07 (SPEC 7.2.4, 16 F-05)", () => {
  const demoIndex = createDemoIndex();

  it("evaluates all 20 scripted commands in test/fixtures/commands.json with >= 12 tier-one hit rate (Gate IG-07)", () => {
    expect(commandsData.length).toBe(20);

    let confidentHits = 0;

    for (const cmd of commandsData) {
      const result = resolveLocal(cmd.transcript, demoIndex);

      expect(
        result.outcome,
        `Command "${cmd.transcript}" expected outcome ${cmd.expectedOutcome}, got ${result.outcome}`
      ).toBe(cmd.expectedOutcome);

      if (cmd.expectedOutcome === "CONFIDENT") {
        expect(result.target).toBeDefined();
        expect(result.target?.name).toBe(cmd.expectedTargetName);
        expect(result.action?.verb).toBe(cmd.expectedVerb);
        expect(result.action?.elementId).toBe(result.target?.id);
        confidentHits++;
      } else if (cmd.expectedOutcome === "AMBIGUOUS") {
        expect(result.candidates).toBeDefined();
        expect(result.candidates?.length).toBeGreaterThanOrEqual(MIN_CLARIFY_CANDIDATES);
        expect(result.candidates?.length).toBeLessThanOrEqual(MAX_CLARIFY_CANDIDATES);
        if ("expectedCandidates" in cmd) {
          const names = result.candidates?.map((c) => c.name);
          expect(names).toEqual(cmd.expectedCandidates);
        }
      } else if (cmd.expectedOutcome === "MISS") {
        expect(result.target).toBeUndefined();
        expect(result.action).toBeUndefined();
      }
    }

    console.log(`[IG-07 RESULT] Confident tier-one hit rate: ${confidentHits} of 20 scripted commands (${(confidentHits / 20 * 100).toFixed(1)}%)`);

    // Gate IG-07 & F-05: at least 12 of 20 commands resolve CONFIDENT with correct target
    expect(confidentHits).toBeGreaterThanOrEqual(12);
  });

  it("named F-05 test case 1: 'download the itinerary' returns AMBIGUOUS with exactly the two download ids", () => {
    const result = resolveLocal("download the itinerary", demoIndex);

    expect(result.outcome).toBe("AMBIGUOUS");
    expect(result.candidateIds).toEqual(["el_23", "el_24"]);
    expect(result.candidates?.length).toBe(2);
    expect(result.candidates?.[0].id).toBe("el_23");
    expect(result.candidates?.[1].id).toBe("el_24");
    expect(result.candidates?.[0].name).toBe("Download");
    expect(result.candidates?.[1].name).toBe("Download");
  });

  it("named F-05 test case 2: 'make me a sandwich' returns MISS", () => {
    const result = resolveLocal("make me a sandwich", demoIndex);

    expect(result.outcome).toBe("MISS");
    expect(result.target).toBeUndefined();
    expect(result.action).toBeUndefined();
    expect(result.topScore).toBeLessThan(LOCAL_AMBIGUOUS_FLOOR);
  });

  it("named F-05 test case 3: disabled elements never win", () => {
    // Index with disabled exact match and enabled partial match
    const indexWithDisabled: ElementIndex = {
      buildId: "test-build-disabled",
      url: "http://localhost:5174/",
      title: "Test Disabled",
      builtAt: Date.now(),
      viewportW: 1024,
      viewportH: 768,
      docH: 1000,
      entries: [
        {
          id: "el_disabled",
          role: "button",
          name: "Submit booking",
          nameKey: "submit booking",
          x: 0.5,
          y: 0.2,
          enabled: false, // DISABLED
          visible: true,
          inViewport: true,
          value: null,
          tag: "button",
          inputType: null,
          isPassword: false,
        },
        {
          id: "el_enabled",
          role: "button",
          name: "Submit form",
          nameKey: "submit form",
          x: 0.5,
          y: 0.4,
          enabled: true, // ENABLED
          visible: true,
          inViewport: true,
          value: null,
          tag: "button",
          inputType: null,
          isPassword: false,
        },
      ],
      truncated: false,
    };

    const result = resolveLocal("click submit booking", indexWithDisabled);

    // Disabled element must never win as CONFIDENT target
    if (result.outcome === "CONFIDENT") {
      expect(result.target?.enabled).toBe(true);
      expect(result.target?.id).not.toBe("el_disabled");
    } else {
      expect(["AMBIGUOUS", "MISS"]).toContain(result.outcome);
      if (result.outcome === "AMBIGUOUS") {
        expect(result.candidateIds).not.toContain("el_disabled");
      }
    }

    // Solitary disabled element matching exactly returns MISS, never CONFIDENT
    const solitaryDisabledIndex: ElementIndex = {
      ...indexWithDisabled,
      entries: [indexWithDisabled.entries[0]],
    };
    const solitaryResult = resolveLocal("click submit booking", solitaryDisabledIndex);
    expect(solitaryResult.outcome).toBe("MISS");
    expect(solitaryResult.target).toBeUndefined();
  });

  it("respects tunable decision thresholds from src/shared/constants.ts", () => {
    expect(LOCAL_CONFIDENT_THRESHOLD).toBe(0.85);
    expect(LOCAL_MARGIN).toBe(0.1);
    expect(LOCAL_AMBIGUOUS_FLOOR).toBe(0.6);
    expect(MIN_CLARIFY_CANDIDATES).toBe(2);
    expect(MAX_CLARIFY_CANDIDATES).toBe(4);
  });

  it("handles value extraction for fill verb and select verb", () => {
    const resultFill = resolveLocal("type John Doe in passenger name", demoIndex);
    expect(resultFill.outcome).toBe("CONFIDENT");
    expect(resultFill.action?.verb).toBe("fill");
    expect(resultFill.action?.value).toBe("john doe");
    expect(resultFill.target?.name).toBe("Passenger name");

    const resultInto = resolveLocal("enter user@example.com into email address", demoIndex);
    expect(resultInto.outcome).toBe("CONFIDENT");
    expect(resultInto.action?.verb).toBe("fill");
    expect(resultInto.action?.value).toBe("userexamplecom"); // cleaned per step 1-4
    expect(resultInto.target?.name).toBe("Email address");
  });

  it("keeps check and uncheck as their own verbs on a checkbox (HD-14)", () => {
    const off = resolveLocal("uncheck non-stop only", demoIndex);
    expect(off.outcome).toBe("CONFIDENT");
    expect(off.target?.name).toBe("Non-stop only");
    expect(off.action?.verb).toBe("uncheck");

    const on = resolveLocal("check morning departures", demoIndex);
    expect(on.outcome).toBe("CONFIDENT");
    expect(on.target?.name).toBe("Morning departures");
    expect(on.action?.verb).toBe("check");

    // The lexicon's other words for the same two states.
    expect(resolveLocal("turn off non-stop only", demoIndex).action?.verb).toBe("uncheck");
    expect(resolveLocal("turn on refundable fares", demoIndex).action?.verb).toBe("check");

    // A bare click on a checkbox is still a click: the user asked to toggle it.
    expect(resolveLocal("click non-stop only", demoIndex).action?.verb).toBe("click");
  });

  it("falls back to the default verb when a toggle word lands on something with no state (HD-14)", () => {
    // The lexicon reads the leading "enable" and "turn off" as toggle verbs,
    // but a button and a link have no state to set. Without the fallback, SPEC
    // 7.6.1 rule 8 refuses the batch out loud instead of pressing the button.
    const button = resolveLocal("enable search flights", demoIndex);
    expect(button.outcome).toBe("CONFIDENT");
    expect(button.target?.name).toBe("Search flights");
    expect(button.action?.verb).toBe("click");

    const link = resolveLocal("turn off help", demoIndex);
    expect(link.outcome).toBe("CONFIDENT");
    expect(link.target?.role).toBe("link");
    expect(link.action?.verb).toBe("click");
  });

  it("defaults to click for button/link when no verb is present, focus otherwise (SPEC 7.2.2)", () => {
    // "flights" has no verb; flights is a link -> default verb is click
    const resultLink = resolveLocal("flights", demoIndex);
    expect(resultLink.outcome).toBe("CONFIDENT");
    expect(resultLink.action?.verb).toBe("click");

    // "search flights" has no verb (as a phrase without click/press); button -> default verb is click
    const resultBtn = resolveLocal("search flights", demoIndex);
    expect(resultBtn.outcome).toBe("CONFIDENT");
    expect(resultBtn.action?.verb).toBe("click");
  });
});
