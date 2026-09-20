/**
 * Gemini Resolver (Tier Two) — SPEC §5.3–5.6, §7.3, §7.4, §7.6, §11.3, §11.4.
 *
 * Handles model-based action resolution when the local resolver returns MISS or unresolvable AMBIGUOUS.
 */

import {
  type Action,
  ActionSchema,
  type ElementIndexEntry,
  type PromptElement,
  type ResolveRequest,
  ResolverResponseSchema,
  type Verb,
} from "../../shared/contracts";
import {
  MALFORMED_CONFIDENCE_PENALTY,
  MAX_ACTIONS,
} from "../../shared/constants";
import {
  type FetchFn,
  GeminiClientError,
  callGenerateContent,
  isModelTierDisabledForSession,
} from "./client";
import {
  buildResolverRequestBody,
  toPromptElements,
} from "./prompts";
import { normalizeTranscript } from "../../shared/normalize";
import { isValidVerbForRole } from "../execute/validate";
import type { BrowserContext } from "./context";

export type GeminiOutcome = "CONFIDENT" | "AMBIGUOUS" | "MISS" | "ERROR";

export interface GeminiResolveResult {
  outcome: GeminiOutcome;
  actions: Action[];
  confidence: number;
  ambiguousWith?: string[];
  clarifyingQuestion?: string;
  spokenMessage?: string;
  error?: string;
}

export interface GeminiResolveOptions {
  apiKey?: string | null;
  model?: string;
  fetchFn?: FetchFn;
  signal?: AbortSignal;
  /** Candidates from local resolver to fall back to if model is rate limited or times out. */
  localCandidates?: ElementIndexEntry[];
  /** Date, time, current page and open tabs, sent as their own prompt part. */
  context?: BrowserContext;
}

/**
 * Extracts and parses the structured output from Gemini's response body.
 * Supports both the full API envelope (candidates[0].content.parts[0].text)
 * and direct JSON output.
 */
function extractModelOutput(rawBodyText: string): unknown {
  const outer = JSON.parse(rawBodyText);
  if (
    outer &&
    typeof outer === "object" &&
    Array.isArray(outer.candidates) &&
    outer.candidates[0]?.content?.parts?.[0]?.text
  ) {
    const textPart = outer.candidates[0].content.parts[0].text;
    return JSON.parse(textPart);
  }
  return outer;
}

/**
 * The explicit toggle the command asked for, or null if it asked for no toggle.
 *
 * HD-14: "check" and "uncheck" name a state to end in. `click` only toggles
 * whichever state the element happens to be in, so a command that names a state
 * must never execute as one -- the model cannot see the live checkbox and is in
 * no position to pick the direction.
 */
export function toggleIntentOf(transcript: string): "check" | "uncheck" | null {
  const verb = normalizeTranscript(transcript).verb;
  return verb === "check" || verb === "uncheck" ? verb : null;
}

/**
 * Resolves a spoken command via Gemini when tier one misses.
 */
export async function resolveWithGemini(
  request: ResolveRequest,
  indexEntries: ElementIndexEntry[],
  options: GeminiResolveOptions
): Promise<GeminiResolveResult> {
  const { apiKey, model, fetchFn, signal, localCandidates, context } = options;

  // 1. Check if model tier is available
  if (!apiKey || apiKey.trim().length === 0) {
    return {
      outcome: "ERROR",
      actions: [],
      confidence: 0,
      spokenMessage: "Add your API key in the extension options.",
      error: "NO_API_KEY",
    };
  }

  if (isModelTierDisabledForSession()) {
    return {
      outcome: "ERROR",
      actions: [],
      confidence: 0,
      spokenMessage: "Your API key isn't working.",
      error: "SESSION_DISABLED",
    };
  }

  // 2. Prepare prompt elements and request body
  const promptElements: PromptElement[] =
    request.index && request.index.length > 0
      ? request.index
      : toPromptElements(indexEntries);

  const requestBody = buildResolverRequestBody(request.transcript, promptElements, context);

  // Index map for fast element lookup
  const entryById = new Map<string, ElementIndexEntry>();
  for (const entry of indexEntries) {
    entryById.set(entry.id, entry);
  }

  // 3. Make HTTP request via Gemini client
  let rawResponseText: string;
  try {
    rawResponseText = await callGenerateContent(requestBody, {
      apiKey,
      model,
      fetchFn,
      signal,
    });
  } catch (err) {
    const clientErr =
      err instanceof GeminiClientError
        ? err
        : new GeminiClientError(
            "NETWORK_ERROR",
            err instanceof Error ? err.message : String(err),
            "I couldn't reach the model."
          );

    // Fallback on timeout or 429 per SPEC §11.4:
    // If local resolver produced candidates, fall back to clarification.
    if (
      (clientErr.code === "TIMEOUT" || clientErr.code === "RATE_LIMITED") &&
      localCandidates &&
      localCandidates.length >= 2
    ) {
      return {
        outcome: "AMBIGUOUS",
        actions: [],
        confidence: 0.6,
        ambiguousWith: localCandidates.map((c) => c.id),
        spokenMessage: "Which one did you mean?",
      };
    }

    return {
      outcome: "ERROR",
      actions: [],
      confidence: 0,
      spokenMessage: clientErr.spokenMessage,
      error: clientErr.code,
    };
  }

  // 4. Parse response JSON (SPEC §11.4 rule 3)
  let rawParsed: unknown;
  try {
    rawParsed = extractModelOutput(rawResponseText);
  } catch (parseError) {
    // Log raw response body length and validation error; NEVER log the body itself
    console.warn(
      `[ECHO Gemini] Body parse failure. Byte length: ${rawResponseText.length}. Error:`,
      parseError instanceof Error ? parseError.message : String(parseError)
    );
    return {
      outcome: "MISS",
      actions: [],
      confidence: 0,
      spokenMessage: "I'm not sure which one you mean.",
      error: "PARSE_ERROR",
    };
  }

  // 5. Schema validation (SPEC §5.5, §11.4 rule 3)
  const schemaResult = ResolverResponseSchema.safeParse(rawParsed);
  if (!schemaResult.success) {
    console.warn(
      `[ECHO Gemini] Schema validation failure. Byte length: ${rawResponseText.length}. Errors:`,
      schemaResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    );
    return {
      outcome: "MISS",
      actions: [],
      confidence: 0,
      spokenMessage: "I'm not sure which one you mean.",
      error: "SCHEMA_VALIDATION_FAILED",
    };
  }

  const modelData = schemaResult.data;

  // 6. Confidence clamping and penalty (SPEC §11.4 rule 5)
  let confidence = modelData.confidence;
  if (confidence < 0 || confidence > 1) {
    confidence = Math.min(Math.max(confidence, 0), 1) - MALFORMED_CONFIDENCE_PENALTY;
    confidence = Math.max(0, confidence);
  }

  // 7. Actions truncation (SPEC §11.4 rule 4)
  let rawActions = modelData.actions;
  if (rawActions.length > MAX_ACTIONS) {
    console.warn(
      `[ECHO Gemini] Truncating actions from ${rawActions.length} to ${MAX_ACTIONS}`
    );
    rawActions = rawActions.slice(0, MAX_ACTIONS);
  }
  if (request.mode === "single" && rawActions.length > 1) {
    console.warn(
      `[ECHO Gemini] Mode is 'single': truncating actions from ${rawActions.length} to 1`
    );
    rawActions = rawActions.slice(0, 1);
  }

  // 8. Action validation and elementId membership check (SPEC §7.6.1, §11.4 rule 3)
  // HD-14: a command that named a state ("uncheck the nonstop filter") is held
  // to that state even when the model answers with the toggling `click`.
  const toggleIntent = toggleIntentOf(request.transcript);
  const validatedActions: Action[] = [];
  for (const rawAction of rawActions) {
    // Unknown elementId check: must exist in index
    const targetEntry = entryById.get(rawAction.elementId);
    if (!targetEntry) {
      console.warn(`[ECHO Gemini] Element id not in index: ${rawAction.elementId}`);
      return {
        outcome: "MISS",
        actions: [],
        confidence: 0,
        spokenMessage: "I'm not sure which one you mean.",
        error: `UNKNOWN_ELEMENT_ID: ${rawAction.elementId}`,
      };
    }

    // Element must be enabled and not a password element (SPEC §7.6.1 rules 4 & 5)
    if (!targetEntry.enabled || targetEntry.isPassword) {
      console.warn(
        `[ECHO Gemini] Target element ${rawAction.elementId} is disabled or password`
      );
      return {
        outcome: "MISS",
        actions: [],
        confidence: 0,
        spokenMessage: "I'm not sure which one you mean.",
        error: "TARGET_NOT_ACTIONABLE",
      };
    }

    // HD-14: rewrite `click` to the toggle the user actually named. Only for a
    // lone action -- in a sequence the leading verb says nothing about the
    // later steps -- and only onto a role that can take it (SPEC §7.6.2).
    let verb: Verb = rawAction.verb;
    if (
      toggleIntent !== null &&
      verb === "click" &&
      rawActions.length === 1 &&
      isValidVerbForRole(toggleIntent, targetEntry)
    ) {
      verb = toggleIntent;
    }

    // Verb role validity (SPEC §7.6.2)
    if (!isValidVerbForRole(verb, targetEntry)) {
      console.warn(
        `[ECHO Gemini] Verb "${verb}" invalid for role "${targetEntry.role}"`
      );
      return {
        outcome: "MISS",
        actions: [],
        confidence: 0,
        spokenMessage: "I'm not sure which one you mean.",
        error: "INVALID_VERB_ROLE",
      };
    }

    // Action value rules (SPEC §5.6, §7.6.1 rules 6 & 7):
    // Extra properties (e.g. selector, xpath) are explicitly omitted when constructing the Action.
    const actionCandidate: Record<string, unknown> = {
      verb,
      elementId: rawAction.elementId,
    };
    if (rawAction.value !== undefined) {
      actionCandidate.value = rawAction.value;
    }

    const actionParse = ActionSchema.safeParse(actionCandidate);
    if (!actionParse.success) {
      console.warn(
        `[ECHO Gemini] Action validation failed:`,
        actionParse.error.message
      );
      return {
        outcome: "MISS",
        actions: [],
        confidence: 0,
        spokenMessage: "I'm not sure which one you mean.",
        error: "ACTION_VALIDATION_FAILED",
      };
    }

    // Check value constraints if present
    if (actionParse.data.value) {
      if (
        actionParse.data.value.length > 200 ||
        // eslint-disable-next-line no-control-regex
        /[\u0000-\u001f\u007f-\u009f]/.test(actionParse.data.value)
      ) {
        return {
          outcome: "MISS",
          actions: [],
          confidence: 0,
          spokenMessage: "I'm not sure which one you mean.",
          error: "ACTION_VALUE_INVALID",
        };
      }
    }

    validatedActions.push(actionParse.data);
  }

  // 9. Confidence Gating (SPEC §7.4)
  const ambiguousWith = modelData.ambiguousWith ?? [];
  const hasAmbiguity = ambiguousWith.length > 0;

  if (confidence >= 0.75 && !hasAmbiguity && validatedActions.length > 0) {
    return {
      outcome: "CONFIDENT",
      actions: validatedActions,
      confidence,
    };
  }

  if (confidence < 0.75 || hasAmbiguity) {
    return {
      outcome: "AMBIGUOUS",
      actions: validatedActions,
      confidence,
      ambiguousWith,
      clarifyingQuestion: modelData.clarifyingQuestion,
      spokenMessage: modelData.clarifyingQuestion || "I'm not sure which one you mean.",
    };
  }

  return {
    outcome: "MISS",
    actions: [],
    confidence: 0,
    spokenMessage: "I'm not sure which one you mean.",
  };
}
