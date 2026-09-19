/**
 * Transcript and element name normalization — SPEC 7.2.1, 7.2.2.
 */

import { type Verb } from "./contracts";

/** SPEC 7.2.1 step 5: leading filler phrases. */
const RAW_FILLER_PHRASES = [
  "could you",
  "i want to",
  "i'd like to",
  "can you",
  "please",
  "okay",
  "hey",
  "ok",
  "um",
  "uh",
] as const;

export const FILLER_PHRASES = RAW_FILLER_PHRASES.map((f) =>
  f.replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim()
).sort((a, b) => b.length - a.length);

/**
 * SPEC 7.2.2: verb lexicon mapping spoken phrases to canonical verbs.
 * Multi-word phrases are listed first so greedy prefix matching finds them.
 */
export const VERB_LEXICON: ReadonlyArray<{ spoken: string; verb: Verb }> = [
  { spoken: "scroll to", verb: "scrollTo" },
  { spoken: "take me to", verb: "scrollTo" },
  { spoken: "jump to", verb: "scrollTo" },
  { spoken: "focus on", verb: "focus" },
  { spoken: "turn off", verb: "uncheck" },
  { spoken: "turn on", verb: "check" },
  { spoken: "go to", verb: "click" },
  { spoken: "click", verb: "click" },
  { spoken: "press", verb: "click" },
  { spoken: "tap", verb: "click" },
  { spoken: "hit", verb: "click" },
  { spoken: "push", verb: "click" },
  { spoken: "open", verb: "click" },
  { spoken: "select", verb: "click" }, // Note: on select element, maps to select in execution
  { spoken: "choose", verb: "click" },
  { spoken: "type", verb: "fill" },
  { spoken: "enter", verb: "fill" },
  { spoken: "fill", verb: "fill" },
  { spoken: "put", verb: "fill" },
  { spoken: "write", verb: "fill" },
  { spoken: "set", verb: "fill" },
  { spoken: "check", verb: "check" },
  { spoken: "tick", verb: "check" },
  { spoken: "enable", verb: "check" },
  { spoken: "uncheck", verb: "uncheck" },
  { spoken: "untick", verb: "uncheck" },
  { spoken: "disable", verb: "uncheck" },
  { spoken: "find", verb: "scrollTo" },
  { spoken: "focus", verb: "focus" },
];

/** SPEC 7.2.1 step 7: stop words removed from remainder. */
export const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "on",
  "to",
  "for",
  "of",
  "this",
  "that",
  "my",
  "button",
  "link",
  "field",
  "box",
]);

/** SPEC 7.2.1 / 7.2.3: role hint words extracted during step 7. */
export const ROLE_HINT_WORDS = new Set(["button", "link", "field", "box"] as const);
export type RoleHint = "button" | "link" | "field" | "box";

export interface NormalizedTranscript {
  /** The original input string. */
  raw: string;
  /** Steps 1-4: NFKD, lowercase, replace &, [a-z0-9 ], collapsed whitespace. */
  cleaned: string;
  /** Step 5: leading filler removed. */
  withoutFiller: string;
  /** Step 6: parsed canonical verb, or null if none. */
  verb: Verb | null;
  /** Step 6: the actual spoken verb matched. */
  spokenVerb: string | null;
  /** Step 7: stop words removed, final matching string. */
  remainder: string;
  /** Step 7: extracted role hint from stop words, if any. */
  roleHint: RoleHint | null;
  /** Value extracted for fill verb (split on in/into/as), if applicable. */
  fillValue: string | null;
}

/**
 * Normalizes text through steps 1-4 of SPEC 7.2.1:
 * 1. Unicode NFKD, strip combining marks
 * 2. Lowercase
 * 3. Replace & with "and"; strip all characters except [a-z0-9 ]
 * 4. Collapse whitespace, trim
 */
export function cleanText(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalizes an accessible name to `nameKey` per SPEC 7.2.1.
 * "Applied identically to the transcript and to every name when computing nameKey."
 */
export function normalizeNameKey(name: string): string {
  const cleaned = cleanText(name);
  if (!cleaned) return "";

  // Step 5: remove leading filler
  let withoutFiller = cleaned;
  let changed = true;
  while (changed) {
    changed = false;
    for (const filler of FILLER_PHRASES) {
      if (withoutFiller === filler) {
        withoutFiller = "";
        changed = true;
        break;
      }
      if (withoutFiller.startsWith(filler + " ")) {
        withoutFiller = withoutFiller.slice(filler.length + 1).trim();
        changed = true;
        break;
      }
    }
  }

  // Step 6: remove leading verb
  let remainder = withoutFiller;
  for (const { spoken } of VERB_LEXICON) {
    if (remainder === spoken) {
      remainder = "";
      break;
    }
    if (remainder.startsWith(spoken + " ")) {
      remainder = remainder.slice(spoken.length + 1).trim();
      break;
    }
  }

  // Step 7: remove stop words from remainder
  const tokens = remainder.split(" ").filter((t) => t.length > 0);
  const filtered = tokens.filter((t) => !STOP_WORDS.has(t));
  const result = filtered.join(" ").trim();

  // If removing stop words or verb emptied the string, preserve step 4 cleaned text
  return result || cleaned;
}

/**
 * Normalizes a user utterance according to all 7 steps of SPEC 7.2.1 & 7.2.2.
 */
export function normalizeTranscript(raw: string): NormalizedTranscript {
  const cleaned = cleanText(raw);
  if (!cleaned) {
    return {
      raw,
      cleaned: "",
      withoutFiller: "",
      verb: null,
      spokenVerb: null,
      remainder: "",
      roleHint: null,
      fillValue: null,
    };
  }

  // Step 5: remove leading filler
  let withoutFiller = cleaned;
  let changed = true;
  while (changed) {
    changed = false;
    for (const filler of FILLER_PHRASES) {
      if (withoutFiller === filler) {
        withoutFiller = "";
        changed = true;
        break;
      }
      if (withoutFiller.startsWith(filler + " ")) {
        withoutFiller = withoutFiller.slice(filler.length + 1).trim();
        changed = true;
        break;
      }
    }
  }

  // Step 6: remove leading verb when it maps to a known verb
  let verb: Verb | null = null;
  let spokenVerb: string | null = null;
  let afterVerb = withoutFiller;

  for (const item of VERB_LEXICON) {
    if (afterVerb === item.spoken) {
      verb = item.verb;
      spokenVerb = item.spoken;
      afterVerb = "";
      break;
    }
    if (afterVerb.startsWith(item.spoken + " ")) {
      verb = item.verb;
      spokenVerb = item.spoken;
      afterVerb = afterVerb.slice(item.spoken.length + 1).trim();
      break;
    }
  }

  // Value/target splitting for fill verb: split on " in ", " into ", " as "
  let fillValue: string | null = null;
  let targetString = afterVerb;

  if (verb === "fill") {
    // Look for separators: " into ", " in ", " as "
    const splitRegex = /\b(into|in|as)\b/;
    const match = splitRegex.exec(afterVerb);
    if (match && match.index > 0) {
      fillValue = afterVerb.slice(0, match.index).trim();
      targetString = afterVerb.slice(match.index + match[0].length).trim();
    }
  }

  // Step 7: remove stop words from remainder; retain roleHint
  let roleHint: RoleHint | null = null;
  const tokens = targetString.split(" ").filter((t) => t.length > 0);
  const remainingTokens: string[] = [];

  for (const token of tokens) {
    if (ROLE_HINT_WORDS.has(token as RoleHint)) {
      roleHint = token as RoleHint;
    }
    if (!STOP_WORDS.has(token)) {
      remainingTokens.push(token);
    }
  }

  const remainder = remainingTokens.join(" ").trim();

  return {
    raw,
    cleaned,
    withoutFiller,
    verb,
    spokenVerb,
    remainder,
    roleHint,
    fillValue,
  };
}

/**
 * Sanitizes strings for model prompts per SPEC 8.4:
 * 1. Strip all C0 and C1 control characters
 * 2. Collapse all whitespace runs (including newlines) to a single space
 * 3. Truncate to the field's maximum length
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
