/**
 * Local Resolver (tier one) — T0-07 (F-05), SPEC sections 7.1, 7.2.3, 7.2.4, 7.4.
 */

import {
  type Action,
  ActionSchema,
  type ElementIndex,
  type ElementIndexEntry,
  type Verb,
} from "../../shared/contracts";
import {
  LOCAL_AMBIGUOUS_FLOOR,
  LOCAL_CONFIDENT_THRESHOLD,
  LOCAL_MARGIN,
  MAX_CLARIFY_CANDIDATES,
  MIN_CLARIFY_CANDIDATES,
} from "../../shared/constants";
import {
  type NormalizedTranscript,
  normalizeTranscript,
} from "../../shared/normalize";
import { type ScoreBreakdown, isValidVerbForRole, scoreCandidate } from "./score";

export type LocalResolveOutcome = "CONFIDENT" | "AMBIGUOUS" | "MISS";

/** Roles a bare "name" command clicks; everything else is focused (SPEC 7.2.2). */
const DEFAULT_CLICK_ROLES = [
  "button",
  "link",
  "checkbox",
  "radio",
  "tab",
  "menuitem",
  "option",
];

/** SPEC 7.2.2: the verb to use when the command named none. */
export function defaultVerbForRole(role: string): Verb {
  return DEFAULT_CLICK_ROLES.includes(role) ? "click" : "focus";
}

export interface ScoredEntry {
  entry: ElementIndexEntry;
  score: number;
  breakdown: ScoreBreakdown;
}

export interface LocalResolveResult {
  outcome: LocalResolveOutcome;
  normalized: NormalizedTranscript;
  target?: ElementIndexEntry;
  action?: Action;
  candidates?: ElementIndexEntry[];
  candidateIds?: string[];
  topScore: number;
  secondScore: number;
  scoredEntries: ScoredEntry[];
}

/**
 * Resolves an element action locally per SPEC 7.2.
 *
 * @param transcript Spoken command string or already-normalized transcript
 * @param index Page element index
 * @returns LocalResolveResult with outcome CONFIDENT, AMBIGUOUS, or MISS
 */
export function resolveLocal(
  transcript: string | NormalizedTranscript,
  index: ElementIndex
): LocalResolveResult {
  const normalized =
    typeof transcript === "string" ? normalizeTranscript(transcript) : transcript;

  if (!index || !index.entries || index.entries.length === 0) {
    return {
      outcome: "MISS",
      normalized,
      topScore: 0,
      secondScore: 0,
      scoredEntries: [],
    };
  }

  // Score all candidate entries in the index
  const scoredEntries: ScoredEntry[] = index.entries.map((entry) => {
    const breakdown = scoreCandidate(normalized.remainder, entry, {
      roleHint: normalized.roleHint,
      parsedVerb: normalized.verb,
    });
    return {
      entry,
      score: breakdown.total,
      breakdown,
    };
  });

  // Sort descending by score. Break ties stably by index order.
  scoredEntries.sort((a, b) => b.score - a.score);

  const topScore = scoredEntries.length > 0 ? scoredEntries[0].score : 0;
  const secondScore = scoredEntries.length > 1 ? scoredEntries[1].score : 0;

  // 1. CONFIDENT: s1 >= 0.85 and s1 - s2 >= 0.10 and target is enabled (SPEC 7.2.4, 7.6.1 rule 4)
  if (
    topScore >= LOCAL_CONFIDENT_THRESHOLD &&
    topScore - secondScore >= LOCAL_MARGIN &&
    scoredEntries[0].entry.enabled
  ) {
    const target = scoredEntries[0].entry;

    // Determine verb per SPEC 7.2.2:
    // When no verb is present, default to click if role in {button, link, checkbox, radio, tab, menuitem, option}, focus otherwise.
    // "select" on a <select> element maps to verb "select".
    let verb: Verb;
    if (normalized.verb !== null) {
      if (
        (target.tag === "select" || target.role === "combobox" || target.role === "listbox") &&
        normalized.spokenVerb === "select"
      ) {
        verb = "select";
      } else if (
        (normalized.verb === "check" || normalized.verb === "uncheck") &&
        !isValidVerbForRole(normalized.verb, target.role)
      ) {
        // HD-14: `check` and `uncheck` are their own actions, not synonyms for
        // `click`, and they only mean anything on something with a state. The
        // lexicon reads "check out the deals" and "turn off the alerts" as
        // toggles; when the winner turns out to be a link or a button, fall
        // back to the default verb rather than let validation refuse the batch
        // over SPEC 7.6.1 rule 8.
        verb =
          normalized.verb === "uncheck" && target.role === "radio"
            ? // SPEC 7.6.2 makes `uncheck` invalid for a radio, and a click
              // would *select* it -- the opposite of what was asked. Keep the
              // verb and let validation refuse it out loud.
              "uncheck"
            : defaultVerbForRole(target.role);
      } else {
        verb = normalized.verb;
      }
    } else {
      verb = defaultVerbForRole(target.role);
    }

    // Determine value for fill / select
    let value: string | undefined = undefined;
    if (verb === "fill") {
      value = normalized.fillValue ?? "";
    } else if (verb === "select") {
      value = normalized.fillValue ?? normalized.remainder ?? "";
    }

    const rawAction = {
      verb,
      elementId: target.id,
      value,
    };

    const action = ActionSchema.parse(rawAction);

    return {
      outcome: "CONFIDENT",
      normalized,
      target,
      action,
      topScore,
      secondScore,
      scoredEntries,
    };
  }

  // 2. AMBIGUOUS: s1 >= 0.60 and 2 to 4 entries score within 0.10 of s1 (SPEC 7.2.4)
  // Disabled elements never win or qualify as candidates
  if (topScore >= LOCAL_AMBIGUOUS_FLOOR) {
    const closeCandidates = scoredEntries.filter(
      (s) =>
        s.entry.enabled &&
        s.score >= topScore - LOCAL_MARGIN &&
        s.score >= LOCAL_AMBIGUOUS_FLOOR
    );

    if (
      closeCandidates.length >= MIN_CLARIFY_CANDIDATES &&
      closeCandidates.length <= MAX_CLARIFY_CANDIDATES
    ) {
      const candidates = closeCandidates.map((c) => c.entry);
      const candidateIds = candidates.map((c) => c.id);

      return {
        outcome: "AMBIGUOUS",
        normalized,
        candidates,
        candidateIds,
        topScore,
        secondScore,
        scoredEntries,
      };
    }
  }

  // 3. Otherwise: MISS
  return {
    outcome: "MISS",
    normalized,
    topScore,
    secondScore,
    scoredEntries,
  };
}
