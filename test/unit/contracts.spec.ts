import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  ActionSchema,
  AnyEnvelopeSchema,
  AudioEventSchema,
  ClarificationStateSchema,
  ELEMENT_ID_PATTERN,
  ENVELOPE_NS,
  ENVELOPE_TARGETS,
  ElementIndexEntrySchema,
  ElementIndexSchema,
  EnvelopeTargetSchema,
  ExecuteRequestSchema,
  ExecuteResultSchema,
  MESSAGE_TYPES,
  MutationEventSchema,
  PromptElementSchema,
  REGIONS,
  RESOLVE_MODES,
  RegionSchema,
  ResolveModeSchema,
  ResolveRequestSchema,
  ResolverResponseSchema,
  STEP_STATUSES,
  SettingsSchema,
  StepResultSchema,
  StepStatusSchema,
  SummaryRecordSchema,
  TELEMETRY_OUTCOMES,
  TELEMETRY_TIERS,
  TelemetryOutcomeSchema,
  TelemetryRecordSchema,
  TelemetryTierSchema,
  VERBOSITIES,
  VERBS,
  VerbSchema,
  VerbositySchema,
  deriveRegion,
  envelopeSchema,
  isEnvelopeFor,
} from "../../src/shared/contracts";
import {
  MAX_ACTIONS,
  MAX_CLARIFY_CANDIDATES,
  MAX_INDEX,
  MIN_CLARIFY_CANDIDATES,
  MODEL_5XX_RETRY_DELAY_MS,
  MODEL_TIMEOUT_MS,
  PAN_CLAMP,
  ROLE_CLASS_BY_ROLE,
  ROLE_CLASS_TIMBRE,
  SCAN_MAX,
  SCAN_TONE_SPACING_MS,
  SCAN_TOTAL_DURATION_MS,
  TONE_ATTACK_MS,
  TONE_BASE_FREQ_HZ,
  TONE_DURATION_MS,
  TONE_RELEASE_MS,
  TONE_SUSTAIN_MS,
  LOCAL_AMBIGUOUS_FLOOR,
  LOCAL_CONFIDENT_THRESHOLD,
  LOCAL_MARGIN,
} from "../../src/shared/constants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function accepts(schema: z.ZodType, value: unknown): boolean {
  return schema.safeParse(value).success;
}

/** A copy of `value` with one required field removed, for missing-field cases. */
function without<T extends object>(value: T, key: keyof T): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  delete copy[key as string];
  return copy;
}

const validEntry = {
  id: "el_12",
  role: "button",
  name: "Add to cart",
  nameKey: "add to cart",
  x: 0.5,
  y: 0.42,
  enabled: true,
  visible: true,
  inViewport: true,
  value: null,
  tag: "button",
  inputType: null,
  isPassword: false,
};

const validIndex = {
  buildId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
  url: "https://example.com/cart",
  title: "Cart — Example",
  builtAt: 1_700_000_000_000,
  viewportW: 1280,
  viewportH: 720,
  docH: 4200,
  entries: [validEntry],
  truncated: false,
};

const validPromptElement = {
  id: "el_12",
  role: "button",
  name: "Add to cart",
  region: "center",
};

// ---------------------------------------------------------------------------
// 5.1 / 5.2
// ---------------------------------------------------------------------------

describe("ElementIndexEntrySchema (SPEC 5.1)", () => {
  it("accepts a valid entry and round-trips it unchanged", () => {
    const parsed = ElementIndexEntrySchema.parse(validEntry);
    expect(parsed).toEqual(validEntry);
  });

  it("accepts a filled text input with a value and inputType", () => {
    expect(
      accepts(ElementIndexEntrySchema, {
        ...validEntry,
        id: "el_0",
        role: "textbox",
        tag: "input",
        inputType: "text",
        value: "ottawa",
      })
    ).toBe(true);
  });

  it("rejects an id that is not el_<n> (SPEC 5.1, 7.6.1 rule 2)", () => {
    expect(accepts(ElementIndexEntrySchema, { ...validEntry, id: "button-3" })).toBe(false);
    expect(accepts(ElementIndexEntrySchema, { ...validEntry, id: "el_1234" })).toBe(false);
  });

  it("rejects coordinates outside 0..1 (SPEC 5.1, 12.6)", () => {
    expect(accepts(ElementIndexEntrySchema, { ...validEntry, x: 1.4 })).toBe(false);
    expect(accepts(ElementIndexEntrySchema, { ...validEntry, y: -0.01 })).toBe(false);
  });

  it("rejects a name longer than 80 chars", () => {
    expect(accepts(ElementIndexEntrySchema, { ...validEntry, name: "a".repeat(81) })).toBe(false);
    expect(accepts(ElementIndexEntrySchema, { ...validEntry, name: "a".repeat(80) })).toBe(true);
  });

  it("rejects a value longer than 40 chars", () => {
    expect(accepts(ElementIndexEntrySchema, { ...validEntry, value: "b".repeat(41) })).toBe(false);
  });

  it("rejects a non-lowercase role or tag (SPEC 5.1, 12.3)", () => {
    expect(accepts(ElementIndexEntrySchema, { ...validEntry, role: "Button" })).toBe(false);
    expect(accepts(ElementIndexEntrySchema, { ...validEntry, tag: "BUTTON" })).toBe(false);
  });

  it("rejects a missing required field", () => {
    expect(accepts(ElementIndexEntrySchema, without(validEntry, "isPassword"))).toBe(false);
  });
});

describe("ElementIndexSchema (SPEC 5.2)", () => {
  it("accepts a valid index", () => {
    expect(ElementIndexSchema.parse(validIndex)).toEqual(validIndex);
  });

  it("accepts exactly MAX_INDEX entries and rejects one more (SPEC 12.2)", () => {
    const entries = Array.from({ length: MAX_INDEX }, (_unused, i) => ({
      ...validEntry,
      id: `el_${i}`,
    }));
    expect(accepts(ElementIndexSchema, { ...validIndex, entries, truncated: true })).toBe(true);
    expect(
      accepts(ElementIndexSchema, {
        ...validIndex,
        entries: [...entries, { ...validEntry, id: "el_120" }],
        truncated: true,
      })
    ).toBe(false);
  });

  it("rejects a title longer than 120 chars", () => {
    expect(accepts(ElementIndexSchema, { ...validIndex, title: "t".repeat(121) })).toBe(false);
  });

  it("rejects an index whose entries contain a malformed entry", () => {
    expect(
      accepts(ElementIndexSchema, { ...validIndex, entries: [{ ...validEntry, x: 2 }] })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5.4 / 5.4.1
// ---------------------------------------------------------------------------

describe("deriveRegion (SPEC 5.4.1)", () => {
  it("checks the vertical bands before the horizontal ones", () => {
    expect(deriveRegion(0.01, 0.01)).toBe("top");
    expect(deriveRegion(0.99, 0.99)).toBe("bottom");
  });

  it("maps each branch of the normative cascade", () => {
    expect(deriveRegion(0.5, 0.1)).toBe("top");
    expect(deriveRegion(0.5, 0.9)).toBe("bottom");
    expect(deriveRegion(0.2, 0.5)).toBe("left");
    expect(deriveRegion(0.8, 0.5)).toBe("right");
    expect(deriveRegion(0.5, 0.5)).toBe("center");
  });

  it("treats the boundary values as center, matching the strict comparisons", () => {
    expect(deriveRegion(0.3, 0.15)).toBe("center");
    expect(deriveRegion(0.7, 0.85)).toBe("center");
  });

  it("only ever returns a value RegionSchema accepts", () => {
    for (let x = 0; x <= 1.0001; x += 0.1) {
      for (let y = 0; y <= 1.0001; y += 0.1) {
        expect(accepts(RegionSchema, deriveRegion(x, y))).toBe(true);
      }
    }
  });
});

describe("PromptElementSchema (SPEC 5.4)", () => {
  it("accepts an element without a value", () => {
    expect(PromptElementSchema.parse(validPromptElement)).toEqual(validPromptElement);
  });

  it("accepts an element with a sanitized value", () => {
    expect(accepts(PromptElementSchema, { ...validPromptElement, value: "ottawa" })).toBe(true);
  });

  it("rejects an unknown region", () => {
    expect(accepts(PromptElementSchema, { ...validPromptElement, region: "middle" })).toBe(false);
  });

  it("strips page data the model must never see (SPEC 5.4 requirement)", () => {
    const parsed = PromptElementSchema.parse({
      ...validPromptElement,
      href: "https://example.com/checkout",
      className: "btn btn-primary",
      innerHTML: "<b>Add to cart</b>",
    });
    expect(parsed).toEqual(validPromptElement);
    expect(Object.keys(parsed)).not.toContain("href");
  });
});

// ---------------------------------------------------------------------------
// 5.3
// ---------------------------------------------------------------------------

describe("ResolveRequestSchema (SPEC 5.3)", () => {
  const valid = {
    transcript: "add the blue shirt to my cart",
    index: [validPromptElement],
    pageTitle: "Cart — Example",
    mode: "single",
  };

  it("accepts a request without candidateIds", () => {
    expect(ResolveRequestSchema.parse(valid)).toEqual(valid);
  });

  it("accepts a clarification reply carrying candidateIds", () => {
    expect(accepts(ResolveRequestSchema, { ...valid, candidateIds: ["el_1", "el_2"] })).toBe(true);
  });

  it("rejects a transcript longer than 200 chars", () => {
    expect(accepts(ResolveRequestSchema, { ...valid, transcript: "x".repeat(201) })).toBe(false);
  });

  it("rejects an unknown mode", () => {
    expect(accepts(ResolveRequestSchema, { ...valid, mode: "batch" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5.6
// ---------------------------------------------------------------------------

describe("ActionSchema (SPEC 5.6, 7.6.1 rule 6)", () => {
  it("accepts every verb that forbids a value, without one", () => {
    for (const verb of ["click", "check", "uncheck", "scrollTo", "focus"] as const) {
      expect(accepts(ActionSchema, { verb, elementId: "el_3" })).toBe(true);
    }
  });

  it("accepts fill and select with a value", () => {
    expect(accepts(ActionSchema, { verb: "fill", elementId: "el_3", value: "ottawa" })).toBe(true);
    expect(accepts(ActionSchema, { verb: "select", elementId: "el_3", value: "Economy" })).toBe(
      true
    );
  });

  it("rejects fill and select without a value", () => {
    expect(accepts(ActionSchema, { verb: "fill", elementId: "el_3" })).toBe(false);
    expect(accepts(ActionSchema, { verb: "select", elementId: "el_3" })).toBe(false);
  });

  it("rejects a value on a verb that forbids one", () => {
    for (const verb of ["click", "check", "uncheck", "scrollTo", "focus"] as const) {
      expect(accepts(ActionSchema, { verb, elementId: "el_3", value: "anything" })).toBe(false);
    }
  });

  it("reports the value problem on the value path", () => {
    const result = ActionSchema.safeParse({ verb: "fill", elementId: "el_3" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["value"]);
    }
  });

  it("rejects a verb outside the closed enum, including navigate (SPEC 8.3, R2.1)", () => {
    expect(accepts(ActionSchema, { verb: "navigate", elementId: "el_3" })).toBe(false);
    expect(accepts(ActionSchema, { verb: "eval", elementId: "el_3" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5.5
// ---------------------------------------------------------------------------

describe("ResolverResponseSchema (SPEC 5.5)", () => {
  const valid = {
    actions: [{ verb: "click", elementId: "el_7" }],
    confidence: 0.91,
  };

  it("accepts the minimal required response", () => {
    expect(ResolverResponseSchema.parse(valid)).toEqual(valid);
  });

  it("accepts the optional clarification fields", () => {
    expect(
      accepts(ResolverResponseSchema, {
        ...valid,
        ambiguousWith: ["el_7", "el_9"],
        clarifyingQuestion: "The one in the header, or the one in the list?",
      })
    ).toBe(true);
  });

  it("accepts an empty actions array (the model found nothing to do)", () => {
    expect(accepts(ResolverResponseSchema, { actions: [], confidence: 0.1 })).toBe(true);
  });

  it("rejects more than MAX_ACTIONS actions", () => {
    const actions = Array.from({ length: MAX_ACTIONS + 1 }, () => ({
      verb: "click",
      elementId: "el_1",
    }));
    expect(accepts(ResolverResponseSchema, { ...valid, actions })).toBe(false);
  });

  it("rejects a missing required field", () => {
    expect(accepts(ResolverResponseSchema, { actions: valid.actions })).toBe(false);
    expect(accepts(ResolverResponseSchema, { confidence: 0.9 })).toBe(false);
  });

  it("rejects a verb outside the closed enum", () => {
    expect(
      accepts(ResolverResponseSchema, {
        ...valid,
        actions: [{ verb: "navigate", elementId: "el_7", value: "https://example.com" }],
      })
    ).toBe(false);
  });

  it("does NOT reject confidence outside [0,1]; SPEC 11.4 rule 5 clamps it instead", () => {
    expect(accepts(ResolverResponseSchema, { ...valid, confidence: 1.5 })).toBe(true);
    expect(accepts(ResolverResponseSchema, { ...valid, confidence: -3 })).toBe(true);
    expect(accepts(ResolverResponseSchema, { ...valid, confidence: "high" })).toBe(false);
  });

  it("does NOT reject an unknown elementId shape; SPEC 11.4 rule 3 treats it as a miss", () => {
    expect(
      accepts(ResolverResponseSchema, { ...valid, actions: [{ verb: "click", elementId: "nope" }] })
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5.7 / 5.8
// ---------------------------------------------------------------------------

describe("ExecuteRequestSchema (SPEC 5.7)", () => {
  const valid = {
    buildId: validIndex.buildId,
    actions: [{ verb: "click", elementId: "el_7" }],
    stepDelayMs: 250,
    playTicks: true,
  };

  it("accepts a one-action batch", () => {
    expect(ExecuteRequestSchema.parse(valid)).toEqual(valid);
  });

  it("accepts a five-action batch and rejects a six-action one (SPEC 7.6.1 rule 9)", () => {
    const five = Array.from({ length: MAX_ACTIONS }, () => ({ verb: "click", elementId: "el_1" }));
    expect(accepts(ExecuteRequestSchema, { ...valid, actions: five })).toBe(true);
    expect(
      accepts(ExecuteRequestSchema, {
        ...valid,
        actions: [...five, { verb: "click", elementId: "el_1" }],
      })
    ).toBe(false);
  });

  it("rejects an empty batch", () => {
    expect(accepts(ExecuteRequestSchema, { ...valid, actions: [] })).toBe(false);
  });

  it("rejects a batch containing one invalid action (R2.3 batch-abort semantics)", () => {
    expect(
      accepts(ExecuteRequestSchema, {
        ...valid,
        actions: [{ verb: "click", elementId: "el_7" }, { verb: "fill", elementId: "el_8" }],
      })
    ).toBe(false);
  });

  it("rejects a missing buildId", () => {
    expect(accepts(ExecuteRequestSchema, { ...valid, buildId: "" })).toBe(false);
  });
});

describe("StepResultSchema (SPEC 5.8)", () => {
  const valid = {
    index: 0,
    verb: "click",
    elementId: "el_7",
    resolvedName: "Add to cart",
    status: "ok",
  };

  it("accepts a successful step", () => {
    expect(StepResultSchema.parse(valid)).toEqual(valid);
  });

  it("accepts a failed step with a null resolvedName and a detail", () => {
    expect(
      accepts(StepResultSchema, {
        ...valid,
        resolvedName: null,
        status: "not_found",
        detail: "stale_build_id",
      })
    ).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(accepts(StepResultSchema, { ...valid, status: "failed" })).toBe(false);
  });

  it("rejects a negative or fractional index", () => {
    expect(accepts(StepResultSchema, { ...valid, index: -1 })).toBe(false);
    expect(accepts(StepResultSchema, { ...valid, index: 1.5 })).toBe(false);
  });
});

describe("ExecuteResultSchema (SPEC 5.8)", () => {
  const valid = {
    ok: true,
    completed: 1,
    results: [{ index: 0, verb: "click", elementId: "el_7", resolvedName: "Add to cart", status: "ok" }],
    failedAtIndex: null,
  };

  it("accepts a successful result", () => {
    expect(ExecuteResultSchema.parse(valid)).toEqual(valid);
  });

  it("accepts a failure naming the failed index", () => {
    expect(accepts(ExecuteResultSchema, { ...valid, ok: false, completed: 0, failedAtIndex: 0 })).toBe(
      true
    );
  });

  it("rejects a non-null, non-numeric failedAtIndex", () => {
    expect(accepts(ExecuteResultSchema, { ...valid, failedAtIndex: "0" })).toBe(false);
  });

  it("rejects a malformed nested StepResult", () => {
    expect(accepts(ExecuteResultSchema, { ...valid, results: [{ index: 0, verb: "click" }] })).toBe(
      false
    );
  });
});

// ---------------------------------------------------------------------------
// 5.9
// ---------------------------------------------------------------------------

describe("ClarificationStateSchema (SPEC 5.9)", () => {
  const createdAt = 1_700_000_000_000;
  const valid = {
    question: "The one in the header, or the one in the list?",
    candidateIds: ["el_3", "el_9"],
    buildId: validIndex.buildId,
    createdAt,
    expiresAt: createdAt + 15_000,
  };

  it("accepts two candidates and four candidates", () => {
    expect(ClarificationStateSchema.parse(valid)).toEqual(valid);
    expect(
      accepts(ClarificationStateSchema, {
        ...valid,
        candidateIds: ["el_1", "el_2", "el_3", "el_4"],
      })
    ).toBe(true);
  });

  it("rejects fewer than MIN_CLARIFY_CANDIDATES candidates (SPEC 7.2.4)", () => {
    expect(accepts(ClarificationStateSchema, { ...valid, candidateIds: ["el_3"] })).toBe(false);
    expect(accepts(ClarificationStateSchema, { ...valid, candidateIds: [] })).toBe(false);
    expect(MIN_CLARIFY_CANDIDATES).toBe(2);
  });

  it("rejects more than MAX_CLARIFY_CANDIDATES candidates", () => {
    expect(
      accepts(ClarificationStateSchema, {
        ...valid,
        candidateIds: ["el_1", "el_2", "el_3", "el_4", "el_5"],
      })
    ).toBe(false);
    expect(MAX_CLARIFY_CANDIDATES).toBe(4);
  });

  it("rejects a question longer than 90 chars", () => {
    expect(accepts(ClarificationStateSchema, { ...valid, question: "q".repeat(91) })).toBe(false);
  });

  it("carries the verb the command named, optionally, and only from the closed enum (HD-14)", () => {
    expect(ClarificationStateSchema.parse({ ...valid, verb: "uncheck" }).verb).toBe("uncheck");
    // Absent when the command named no verb, which is the common case.
    expect(ClarificationStateSchema.parse(valid).verb).toBeUndefined();
    expect(accepts(ClarificationStateSchema, { ...valid, verb: "navigate" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5.10
// ---------------------------------------------------------------------------

describe("AudioEventSchema (SPEC 5.10)", () => {
  it("accepts every variant of the union", () => {
    expect(accepts(AudioEventSchema, { kind: "listenStart" })).toBe(true);
    expect(accepts(AudioEventSchema, { kind: "listenEnd" })).toBe(true);
    expect(accepts(AudioEventSchema, { kind: "error" })).toBe(true);
    expect(
      accepts(AudioEventSchema, {
        kind: "scan",
        entries: [{ id: "el_0", x: 0.1, y: 0.2, role: "link" }],
      })
    ).toBe(true);
    expect(accepts(AudioEventSchema, { kind: "tick", x: 0.5, y: 0.5, role: "button" })).toBe(true);
    expect(
      accepts(AudioEventSchema, { kind: "mutation", points: [{ x: 0.5, y: 0.5, role: "alert" }] })
    ).toBe(true);
  });

  it("round-trips a scan event unchanged", () => {
    const event = {
      kind: "scan" as const,
      entries: [
        { id: "el_0", x: 0, y: 0, role: "link" },
        { id: "el_1", x: 1, y: 1, role: "button" },
      ],
    };
    expect(AudioEventSchema.parse(event)).toEqual(event);
  });

  it("rejects an unknown kind", () => {
    expect(accepts(AudioEventSchema, { kind: "beep" })).toBe(false);
    expect(accepts(AudioEventSchema, {})).toBe(false);
  });

  it("rejects a variant missing its own fields", () => {
    expect(accepts(AudioEventSchema, { kind: "tick", x: 0.5 })).toBe(false);
    expect(accepts(AudioEventSchema, { kind: "scan" })).toBe(false);
  });

  it("rejects coordinates outside 0..1", () => {
    expect(accepts(AudioEventSchema, { kind: "tick", x: 1.2, y: 0.5, role: "button" })).toBe(false);
    expect(
      accepts(AudioEventSchema, {
        kind: "scan",
        entries: [{ id: "el_0", x: 0.1, y: -0.2, role: "link" }],
      })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5.11 / 5.12 / 5.13 / 5.14
// ---------------------------------------------------------------------------

describe("MutationEventSchema (SPEC 5.11)", () => {
  const valid = {
    buildId: validIndex.buildId,
    addedIds: ["el_4"],
    removedIds: [],
    at: 1_700_000_000_000,
  };

  it("accepts a valid mutation event", () => {
    expect(MutationEventSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a non-array id list", () => {
    expect(accepts(MutationEventSchema, { ...valid, addedIds: "el_4" })).toBe(false);
  });

  it("rejects a missing timestamp", () => {
    expect(accepts(MutationEventSchema, without(valid, "at"))).toBe(false);
  });
});

describe("SummaryRecordSchema (SPEC 5.12)", () => {
  const valid = {
    urlHash: "0123456789abcdef",
    text: "A checkout page with a cart summary and a place order button.",
    createdAt: 1_700_000_000_000,
    model: "cache-seed",
  };

  it("accepts a valid record", () => {
    expect(SummaryRecordSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a urlHash that is not 16 lowercase hex chars", () => {
    expect(accepts(SummaryRecordSchema, { ...valid, urlHash: "0123456789ABCDEF" })).toBe(false);
    expect(accepts(SummaryRecordSchema, { ...valid, urlHash: "0123456789abcde" })).toBe(false);
    expect(accepts(SummaryRecordSchema, { ...valid, urlHash: "https://example.com" })).toBe(false);
  });

  it("rejects a summary longer than 1200 chars", () => {
    expect(accepts(SummaryRecordSchema, { ...valid, text: "s".repeat(1201) })).toBe(false);
  });
});

describe("SettingsSchema (SPEC 5.13)", () => {
  const valid = {
    geminiApiKey: null,
    geminiModel: "gemini-model-id",
    verbosity: "fast",
    ttsVoiceName: null,
    ttsRate: 1.6,
    holdKey: "Space",
    scanKey: "KeyM",
    telemetryEnabled: false,
    audioEnabled: true,
    useLocalTts: true,
    elevenLabsApiKey: null,
    mutationAudio: false,
    spatialLinks: true,
    gptZeroApiKey: null,
    aiDetection: true,
  };

  it("accepts the default settings", () => {
    expect(SettingsSchema.parse(valid)).toEqual(valid);
  });

  it("HD-12: page sonification defaults off and spatial links default on", () => {
    // The direction of each default is the decision, not an accident: the human
    // asked for page noise to be gone and for spatial speech to be the norm.
    const parsed = SettingsSchema.parse({
      geminiApiKey: null,
      geminiModel: "gemini-model-id",
      verbosity: "fast",
      ttsVoiceName: null,
      ttsRate: 1.6,
      holdKey: "Space",
      scanKey: "KeyM",
      telemetryEnabled: false,
      audioEnabled: true,
    });
    expect(parsed.mutationAudio).toBe(false);
    expect(parsed.spatialLinks).toBe(true);
  });

  it("HD-13: A.I. detection defaults on and its key defaults to null", () => {
    // On by default because the warning is the point of the feature: a user who
    // never opens this page should still get it. Null key means it stays silent
    // until one is set, rather than failing loudly on every page.
    const parsed = SettingsSchema.parse({
      geminiApiKey: null,
      geminiModel: "gemini-model-id",
      verbosity: "fast",
      ttsVoiceName: null,
      ttsRate: 1.6,
      holdKey: "Space",
      scanKey: "KeyM",
      telemetryEnabled: false,
      audioEnabled: true,
    });
    expect(parsed.aiDetection).toBe(true);
    expect(parsed.gptZeroApiKey).toBeNull();
  });

  it("defaults useLocalTts to true and elevenLabsApiKey to null if omitted", () => {
    const withoutTts = {
      geminiApiKey: null,
      geminiModel: "gemini-model-id",
      verbosity: "fast",
      ttsVoiceName: null,
      ttsRate: 1.6,
      holdKey: "Space",
      scanKey: "KeyM",
      telemetryEnabled: false,
      audioEnabled: true,
    };
    const parsed = SettingsSchema.parse(withoutTts);
    expect(parsed.useLocalTts).toBe(true);
    expect(parsed.elevenLabsApiKey).toBeNull();
  });

  it("accepts a configured key, voice, and verbose mode", () => {
    expect(
      accepts(SettingsSchema, {
        ...valid,
        geminiApiKey: "a-key",
        ttsVoiceName: "Google US English",
        verbosity: "verbose",
        ttsRate: 1.0,
        useLocalTts: false,
        elevenLabsApiKey: "xi-test-key",
      })
    ).toBe(true);
  });

  it("rejects an unknown verbosity", () => {
    expect(accepts(SettingsSchema, { ...valid, verbosity: "chatty" })).toBe(false);
  });

  it("rejects an undefined key where null is required", () => {
    expect(accepts(SettingsSchema, without(valid, "geminiApiKey"))).toBe(false);
  });
});

describe("TelemetryRecordSchema (SPEC 5.14)", () => {
  const valid = {
    ts: 1_700_000_000_000,
    transcript: "add to cart",
    tier: "local",
    confidence: 0.93,
    latencyMs: 412,
    actionCount: 1,
    resolvedName: "Add to cart",
    outcome: "executed",
  };

  it("accepts a valid record", () => {
    expect(TelemetryRecordSchema.parse(valid)).toEqual(valid);
  });

  it("rejects an unknown tier or outcome", () => {
    expect(accepts(TelemetryRecordSchema, { ...valid, tier: "cohere" })).toBe(false);
    expect(accepts(TelemetryRecordSchema, { ...valid, outcome: "cancelled" })).toBe(false);
  });

  it("rejects a transcript longer than 120 chars", () => {
    expect(accepts(TelemetryRecordSchema, { ...valid, transcript: "t".repeat(121) })).toBe(false);
  });

  it("drops fields SPEC 5.14 forbids rather than storing them", () => {
    const parsed = TelemetryRecordSchema.parse({
      ...valid,
      url: "https://example.com/cart",
      apiKey: "secret",
    });
    expect(Object.keys(parsed)).not.toContain("url");
    expect(Object.keys(parsed)).not.toContain("apiKey");
  });
});

// ---------------------------------------------------------------------------
// 5.15 / 5.16
// ---------------------------------------------------------------------------

describe("envelopeSchema (SPEC 5.15)", () => {
  const schema = envelopeSchema(ExecuteRequestSchema);
  const validEnvelope = {
    ns: ENVELOPE_NS,
    target: "content",
    type: "exec.run",
    reqId: "8f14e45f-ceea-467a-9f0c-1d2b3a4c5d6e",
    payload: {
      buildId: validIndex.buildId,
      actions: [{ verb: "click", elementId: "el_7" }],
      stepDelayMs: 250,
      playTicks: true,
    },
  };

  it("accepts a well-formed envelope around a typed payload", () => {
    expect(schema.parse(validEnvelope)).toEqual(validEnvelope);
  });

  it("rejects a foreign namespace", () => {
    expect(accepts(schema, { ...validEnvelope, ns: "other-extension" })).toBe(false);
  });

  it("rejects an unknown target", () => {
    expect(accepts(schema, { ...validEnvelope, target: "popup" })).toBe(false);
  });

  it("rejects a malformed payload", () => {
    expect(accepts(schema, { ...validEnvelope, payload: { buildId: "b" } })).toBe(false);
  });

  it("AnyEnvelopeSchema accepts any payload but still requires the envelope fields", () => {
    expect(accepts(AnyEnvelopeSchema, { ...validEnvelope, payload: { anything: true } })).toBe(true);
    expect(accepts(AnyEnvelopeSchema, { ...validEnvelope, reqId: "" })).toBe(false);
  });
});

describe("isEnvelopeFor (SPEC 5.15 requirement)", () => {
  const envelope = {
    ns: ENVELOPE_NS,
    target: "sw",
    type: "key.down",
    reqId: "req-1",
    payload: { key: "Space" },
  };

  it("returns true for a well-formed envelope addressed to this role", () => {
    expect(isEnvelopeFor(envelope, "sw")).toBe(true);
  });

  it("returns false when the envelope is addressed to another role", () => {
    expect(isEnvelopeFor(envelope, "content")).toBe(false);
    expect(isEnvelopeFor(envelope, "offscreen")).toBe(false);
  });

  it("returns false for a foreign or missing namespace", () => {
    expect(isEnvelopeFor({ ...envelope, ns: "not-echo" }, "sw")).toBe(false);
    expect(isEnvelopeFor(without(envelope, "ns"), "sw")).toBe(false);
  });

  it("returns false for non-object messages without throwing", () => {
    expect(isEnvelopeFor(null, "sw")).toBe(false);
    expect(isEnvelopeFor(undefined, "sw")).toBe(false);
    expect(isEnvelopeFor("echo", "sw")).toBe(false);
    expect(isEnvelopeFor(42, "sw")).toBe(false);
    expect(isEnvelopeFor(true, "sw")).toBe(false);
    expect(isEnvelopeFor([], "sw")).toBe(false);
    expect(isEnvelopeFor(() => undefined, "sw")).toBe(false);
  });

  it("returns false when type or reqId is not a string", () => {
    expect(isEnvelopeFor({ ...envelope, type: 7 }, "sw")).toBe(false);
    expect(isEnvelopeFor({ ...envelope, reqId: null }, "sw")).toBe(false);
  });

  it("narrows the message so the payload is reachable without a cast", () => {
    const msg: unknown = envelope;
    if (isEnvelopeFor<{ key: string }>(msg, "sw")) {
      expect(msg.payload.key).toBe("Space");
      expect(msg.type).toBe("key.down");
    } else {
      throw new Error("guard should have narrowed a valid envelope");
    }
  });
});

describe("MESSAGE_TYPES (SPEC 5.16)", () => {
  it("lists every row of the catalogue exactly once", () => {
    expect(MESSAGE_TYPES).toEqual([
      "key.down",
      "key.up",
      "stt.start",
      "stt.stop",
      "stt.result",
      "stt.error",
      "index.get",
      "index.changed",
      "exec.run",
      "audio.play",
      "ui.highlight",
      "ui.blackout",
      "page.text",
      "scan.request",
      "state.get",
    ]);
    expect(new Set(MESSAGE_TYPES).size).toBe(MESSAGE_TYPES.length);
  });
});

// ---------------------------------------------------------------------------
// Enum schemas
// ---------------------------------------------------------------------------

describe("enum schemas", () => {
  const cases: Array<[string, z.ZodType, readonly string[], string]> = [
    ["RegionSchema (5.4)", RegionSchema, REGIONS, "middle"],
    ["VerbSchema (5.6)", VerbSchema, VERBS, "navigate"],
    ["ResolveModeSchema (5.3)", ResolveModeSchema, RESOLVE_MODES, "batch"],
    ["StepStatusSchema (5.8)", StepStatusSchema, STEP_STATUSES, "failed"],
    ["VerbositySchema (5.13)", VerbositySchema, VERBOSITIES, "chatty"],
    ["TelemetryTierSchema (5.14)", TelemetryTierSchema, TELEMETRY_TIERS, "cohere"],
    ["TelemetryOutcomeSchema (5.14)", TelemetryOutcomeSchema, TELEMETRY_OUTCOMES, "cancelled"],
    ["EnvelopeTargetSchema (5.15)", EnvelopeTargetSchema, ENVELOPE_TARGETS, "popup"],
  ];

  for (const [name, schema, members, invalid] of cases) {
    it(`${name} accepts every member and rejects "${invalid}"`, () => {
      for (const member of members) {
        expect(accepts(schema, member)).toBe(true);
      }
      expect(accepts(schema, invalid)).toBe(false);
      expect(accepts(schema, 0)).toBe(false);
    });
  }

  it("VERBS contains exactly the seven verbs of SPEC 5.6 and no navigate", () => {
    expect(VERBS).toEqual(["click", "fill", "select", "check", "uncheck", "scrollTo", "focus"]);
    expect(VERBS).not.toContain("navigate");
  });
});

// ---------------------------------------------------------------------------
// Constants (SPEC 7.2.4, 9.3, 9.7, 11.4, 12.2)
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("carries the SPEC 7.2.4 decision thresholds", () => {
    expect(LOCAL_CONFIDENT_THRESHOLD).toBe(0.85);
    expect(LOCAL_MARGIN).toBe(0.1);
    expect(LOCAL_AMBIGUOUS_FLOOR).toBe(0.6);
    expect(LOCAL_AMBIGUOUS_FLOOR).toBeLessThan(LOCAL_CONFIDENT_THRESHOLD);
  });

  it("carries the SPEC 9.3 audio mappings", () => {
    expect(PAN_CLAMP).toBe(0.95);
    expect(TONE_BASE_FREQ_HZ).toBe(220);
    expect(ROLE_CLASS_BY_ROLE.link).toBe("navigational");
    expect(ROLE_CLASS_BY_ROLE.button).toBe("control");
    expect(ROLE_CLASS_BY_ROLE.searchbox).toBe("input");
    expect(ROLE_CLASS_TIMBRE.control.oscillator).toBe("triangle");
    expect(ROLE_CLASS_TIMBRE.input.filter.freqMultiplier).toBe(4);
    expect(ROLE_CLASS_TIMBRE.navigational.peakGain).toBe(0.16);
  });

  it("keeps the SPEC 9.3 envelope phases summing to the stated 90 ms duration", () => {
    expect(TONE_ATTACK_MS + TONE_SUSTAIN_MS + TONE_RELEASE_MS).toBe(90);
    expect(TONE_DURATION_MS).toBe(90);
  });

  it("keeps SCAN_MAX * spacing equal to the claimed scan duration (SPEC 9.7, D-006)", () => {
    expect(SCAN_MAX).toBe(30);
    expect(SCAN_TONE_SPACING_MS).toBe(90);
    expect(SCAN_TOTAL_DURATION_MS).toBe(2700);
    expect(SCAN_TOTAL_DURATION_MS).toBe(SCAN_MAX * SCAN_TONE_SPACING_MS);
  });

  it("carries the SPEC 11.4 and 12.2 limits", () => {
    expect(MODEL_TIMEOUT_MS).toBe(2500);
    expect(MODEL_5XX_RETRY_DELAY_MS).toBe(300);
    expect(MAX_ACTIONS).toBe(5);
    expect(MAX_INDEX).toBe(120);
  });

  it("uses the same element id pattern SPEC 7.6.1 rule 2 states", () => {
    expect(ELEMENT_ID_PATTERN.test("el_0")).toBe(true);
    expect(ELEMENT_ID_PATTERN.test("el_119")).toBe(true);
    expect(ELEMENT_ID_PATTERN.test("el_")).toBe(false);
    expect(ELEMENT_ID_PATTERN.test("xel_1")).toBe(false);
  });
});
