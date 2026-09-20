/**
 * Clarification — SPEC 7.5 (F-11).
 *
 * 7.5.1 forms the spoken question in three levels: a distinguishing token, then
 * positional (region), then ordinal. 7.5.2 resolves the user's reply against
 * the pinned candidate set only.
 */

import {
  CLARIFY_QUESTION_MAX_CHARS,
  type ElementIndexEntry,
  deriveRegion,
  type Region,
  VALUE_REQUIRED_VERBS,
  type Verb,
} from "../../shared/contracts";
import {
  CLARIFY_REPLY_THRESHOLD,
  LOCAL_MARGIN,
} from "../../shared/constants";
import { cleanText, normalizeTranscript } from "../../shared/normalize";
import { isValidVerbForRole } from "../execute/validate";
import { defaultVerbForRole } from "./local";
import { scoreCandidate } from "./score";

const ORDINALS = ["first", "second", "third", "fourth"] as const;

const REGION_PHRASE: Record<Region, string> = {
  top: "at the top",
  bottom: "at the bottom",
  left: "on the left",
  right: "on the right",
  center: "in the middle",
};

/** Candidates in document order (ids are assigned in index order, SPEC 5.1). */
export function inDocumentOrder(candidates: ElementIndexEntry[]): ElementIndexEntry[] {
  const n = (id: string) => Number(id.slice(3));
  return [...candidates].sort((a, b) => n(a.id) - n(b.id));
}

function tokens(name: string): string[] {
  return name
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}:]/gu, ""))
    .filter((t) => t.length > 0);
}

function joinOptions(options: string[]): string {
  if (options.length === 2) return `${options[0]} or ${options[1]}`;
  return `${options.slice(0, -1).join(", ")}, or ${options[options.length - 1]}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function cap(question: string): string {
  return question.length <= CLARIFY_QUESTION_MAX_CHARS
    ? question
    : question.slice(0, CLARIFY_QUESTION_MAX_CHARS - 1).trimEnd() + "?";
}

/**
 * SPEC 7.5.1: 1. distinguishing token ("PDF or Word?"), 2. positional by
 * region, 3. ordinal ("The first one or the second one?"). Capped at 90 chars.
 */
export function formatClarifyingQuestion(candidates: ElementIndexEntry[]): string {
  const ordered = inDocumentOrder(candidates);

  // Level 1: the first token of each name that no other candidate's name contains.
  const tokenSets = ordered.map((c) => new Set(tokens(c.name).map((t) => t.toLowerCase())));
  const distinguishing: string[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const own = tokens(ordered[i].name);
    const unique = own.find((t) =>
      tokenSets.every((set, j) => j === i || !set.has(t.toLowerCase()))
    );
    if (!unique) break;
    distinguishing.push(unique);
  }
  if (distinguishing.length === ordered.length) {
    return cap(`${joinOptions(distinguishing)}?`);
  }

  // Level 2: positional, only if every candidate lands in a different region.
  const regions = ordered.map((c) => deriveRegion(c.x, c.y));
  if (new Set(regions).size === regions.length) {
    return cap(`${capitalize(joinOptions(regions.map((r) => `the one ${REGION_PHRASE[r]}`)))}?`);
  }

  // Level 3: ordinal.
  const ord = ordered.map((_, i) => `the ${ORDINALS[i] ?? `number ${i + 1}`} one`);
  return cap(`${capitalize(joinOptions(ord))}?`);
}

export type ClarifyReply =
  | { kind: "resolved"; entry: ElementIndexEntry }
  | { kind: "unresolved" };

function ordinalIndex(words: string[], count: number): number | null {
  for (const w of words) {
    const i = ORDINALS.indexOf(w as (typeof ORDINALS)[number]);
    if (i >= 0 && i < count) return i;
    const m = /^([1-4])(st|nd|rd|th)$/.exec(w);
    if (m && Number(m[1]) <= count) return Number(m[1]) - 1;
    if (w === "last") return count - 1;
  }
  return null;
}

function positional(words: string[], candidates: ElementIndexEntry[]): ElementIndexEntry | null {
  const has = (...w: string[]) => w.some((x) => words.includes(x));
  const extreme = (key: "x" | "y", pick: "min" | "max") => {
    const vals = candidates.map((c) => c[key]);
    const target = pick === "min" ? Math.min(...vals) : Math.max(...vals);
    const hits = candidates.filter((c) => Math.abs(c[key] - target) < 0.02);
    return hits.length === 1 ? hits[0] : null;
  };
  if (has("left")) return extreme("x", "min");
  if (has("right")) return extreme("x", "max");
  if (has("top", "upper", "higher")) return extreme("y", "min");
  if (has("bottom", "lower")) return extreme("y", "max");
  return null;
}

/**
 * SPEC 7.5.2 step 3 and 4: ordinal and positional replies are matched by
 * position; anything else goes through the same scorer with the threshold
 * lowered to CLARIFY_REPLY_THRESHOLD. Only the pinned candidates are considered.
 */
export function resolveClarificationReply(
  transcript: string,
  candidates: ElementIndexEntry[]
): ClarifyReply {
  const ordered = inDocumentOrder(candidates);
  const words = cleanText(transcript).split(" ").filter(Boolean);

  const ord = ordinalIndex(words, ordered.length);
  if (ord !== null) return { kind: "resolved", entry: ordered[ord] };

  const pos = positional(words, ordered);
  if (pos) return { kind: "resolved", entry: pos };

  const normalized = normalizeTranscript(transcript);
  const scored = ordered
    .map((entry) => ({
      entry,
      score: scoreCandidate(normalized.remainder, entry, {
        roleHint: normalized.roleHint,
        parsedVerb: normalized.verb,
      }).total,
    }))
    .sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  if (
    best &&
    best.score >= CLARIFY_REPLY_THRESHOLD &&
    (!next || best.score - next.score >= LOCAL_MARGIN)
  ) {
    return { kind: "resolved", entry: best.entry };
  }
  return { kind: "unresolved" };
}

/**
 * The verb to act on a clarified candidate with (HD-14).
 *
 * The question only ever asked *which* element; the verb was settled before it
 * was asked. Pinning it matters most for `uncheck`: dropping back to the
 * default `click` turns an absolute request into a toggle, so a box that was
 * already off would come back on.
 *
 * Two pinned verbs are discarded rather than used. One the chosen candidate
 * cannot take (SPEC 7.6.2), because refusing the batch out loud is a worse
 * answer than the default. And `fill` or `select`, which need a value this
 * path does not carry -- SPEC 7.6.1 rule 6 would refuse them for having none.
 */
export function verbForClarifiedTarget(entry: ElementIndexEntry, pinned?: Verb): Verb {
  const needsValue = (VALUE_REQUIRED_VERBS as readonly Verb[]).includes(pinned as Verb);
  if (pinned !== undefined && !needsValue && isValidVerbForRole(pinned, entry)) {
    return pinned;
  }
  return defaultVerbForRole(entry.role);
}
