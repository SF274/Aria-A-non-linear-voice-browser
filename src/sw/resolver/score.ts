/**
 * Scoring functions for local resolver — SPEC 7.2.3, 7.6.2.
 */

import { type ElementIndexEntry, type Verb } from "../../shared/contracts";
import { type RoleHint } from "../../shared/normalize";

/**
 * Calculates normalized Levenshtein similarity ratio between two strings in [0, 1].
 * Uses standard Levenshtein distance with substitution cost = 2 (standard indel metric).
 * ratio = (len1 + len2 - dist) / (len1 + len2).
 */
export function levenshteinRatio(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (!s1.length && !s2.length) return 1.0;
  if (!s1.length || !s2.length) return 0.0;

  const m = s1.length;
  const n = s2.length;
  let prev = new Uint16Array(n + 1);
  let curr = new Uint16Array(n + 1);

  for (let j = 0; j <= n; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const c1 = s1.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const c2 = s2.charCodeAt(j - 1);
      if (c1 === c2) {
        curr[j] = prev[j - 1];
      } else {
        const sub = prev[j - 1] + 2;
        const del = prev[j] + 1;
        const ins = curr[j - 1] + 1;
        curr[j] = Math.min(sub, del, ins);
      }
    }
    const temp = prev;
    prev = curr;
    curr = temp;
  }

  const dist = prev[n];
  const totalLen = m + n;
  return Math.max(0, Math.min(1, (totalLen - dist) / totalLen));
}

/**
 * Standard fuzzy token-set ratio returning [0, 1] per SPEC 7.2.3:
 * (sorted intersection plus differences, best of three comparisons).
 */
export function tokenSetRatio(str1: string, str2: string): number {
  if (!str1 && !str2) return 1.0;
  if (!str1 || !str2) return 0.0;

  const t1 = str1.trim().split(/\s+/).filter((t) => t.length > 0);
  const t2 = str2.trim().split(/\s+/).filter((t) => t.length > 0);
  if (t1.length === 0 && t2.length === 0) return 1.0;
  if (t1.length === 0 || t2.length === 0) return 0.0;

  const set1 = new Set(t1);
  const set2 = new Set(t2);

  const intersection: string[] = [];
  const diff1: string[] = [];
  const diff2: string[] = [];

  for (const token of set1) {
    if (set2.has(token)) {
      intersection.push(token);
    } else {
      diff1.push(token);
    }
  }
  for (const token of set2) {
    if (!set1.has(token)) {
      diff2.push(token);
    }
  }

  intersection.sort();
  diff1.sort();
  diff2.sort();

  // If no intersection at all, compare the sorted tokens directly with low weight
  if (intersection.length === 0) {
    const s1 = Array.from(set1).sort().join(" ");
    const s2 = Array.from(set2).sort().join(" ");
    return levenshteinRatio(s1, s2) * 0.5;
  }

  // If both diffs are empty, it is an exact token set match
  if (diff1.length === 0 && diff2.length === 0) {
    return 1.0;
  }

  const sIntersect = intersection.join(" ");
  const sDiff1 = diff1.join(" ");
  const sDiff2 = diff2.join(" ");

  const t0 = sIntersect;
  const t1Joined = [sIntersect, sDiff1].filter(Boolean).join(" ");
  const t2Joined = [sIntersect, sDiff2].filter(Boolean).join(" ");

  const r12 = levenshteinRatio(t1Joined, t2Joined);
  const r01 = levenshteinRatio(t0, t1Joined);
  const r02 = levenshteinRatio(t0, t2Joined);

  // Harmonic mean of coverage (r01, r02) to balance precision and recall
  const harmonicCoverage =
    r01 > 0 && r02 > 0 ? (2 * r01 * r02) / (r01 + r02) : 0;

  // If either diff is empty (one string is a subset of the other), harmonic coverage gives the subset match score
  if (diff1.length === 0 || diff2.length === 0) {
    return Math.round(Math.max(r12, harmonicCoverage) * 10000) / 10000;
  }

  // When both diffs are non-empty, neither string is a subset of the other.
  // Weight r12 by token overlap to prevent coincidental anagram/number character matches
  // from dominating when different controls share common suffix words (e.g. flight times).
  const tokenOverlap = (2 * intersection.length) / (set1.size + set2.size);
  const combined = Math.max(harmonicCoverage, r12 * tokenOverlap);
  return Math.round(combined * 10000) / 10000;
}

/**
 * Validates whether the parsed verb is valid for the target role per SPEC 7.6.2.
 */
export function isValidVerbForRole(verb: Verb, role: string): boolean {
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
      return ["textbox", "searchbox", "spinbutton", "combobox"].includes(role);
    case "select":
      return ["combobox", "listbox"].includes(role);
    case "check":
      return ["checkbox", "switch", "radio"].includes(role);
    case "uncheck":
      return ["checkbox", "switch"].includes(role); // SPEC 7.6.2: uncheck invalid for radio
    case "scrollTo":
      return true; // any
    case "focus":
      return true; // any focusable
    default:
      return false;
  }
}

/**
 * Matches role hint to role classes per SPEC 7.2.3:
 * button -> {button, link}
 * link -> {link}
 * field -> {textbox, searchbox, combobox, spinbutton}
 * box -> {checkbox, radio}
 */
export function matchesRoleHint(roleHint: RoleHint, role: string): boolean {
  switch (roleHint) {
    case "button":
      return role === "button" || role === "link";
    case "link":
      return role === "link";
    case "field":
      return ["textbox", "searchbox", "combobox", "spinbutton"].includes(role);
    case "box":
      return role === "checkbox" || role === "radio";
    default:
      return false;
  }
}

export interface ScoreBreakdown {
  base: number;
  prefixBoost: number;
  roleBoost: number;
  verbBoost: number;
  viewBoost: number;
  disabledPenalty: number;
  total: number;
}

/**
 * Computes candidate score per SPEC 7.2.3:
 * base = tokenSetRatio(normalizedTranscriptRemainder, entry.nameKey)
 * prefixBoost = 0.05 if entry.nameKey startsWith remainder
 * roleBoost = 0.08 if roleHint matches entry.role class
 * verbBoost = 0.05 if parsed verb is valid for entry.role
 * viewBoost = 0.03 if entry.inViewport
 * disabledPenalty = -0.50 if !entry.enabled
 * score = clamp01(base + prefixBoost + roleBoost + verbBoost + viewBoost + disabledPenalty)
 */
export function scoreCandidate(
  remainder: string,
  entry: ElementIndexEntry,
  options?: {
    roleHint?: RoleHint | null;
    parsedVerb?: Verb | null;
  }
): ScoreBreakdown {
  const roleHint = options?.roleHint ?? null;
  const parsedVerb = options?.parsedVerb ?? null;

  // base = tokenSetRatio(normalizedTranscriptRemainder, entry.nameKey)
  const base = remainder.length > 0 ? tokenSetRatio(remainder, entry.nameKey) : 0;

  // prefixBoost = 0.05 if entry.nameKey startsWith the remainder
  const prefixBoost =
    remainder.length > 0 && entry.nameKey.startsWith(remainder) ? 0.05 : 0;

  // roleBoost = 0.08 if roleHint present and matches entry.role class
  const roleBoost =
    roleHint !== null && matchesRoleHint(roleHint, entry.role) ? 0.08 : 0;

  // verbBoost = 0.05 if the parsed verb is valid for entry.role (see 7.6.2)
  const verbBoost =
    parsedVerb !== null && isValidVerbForRole(parsedVerb, entry.role) ? 0.05 : 0;

  // viewBoost = 0.03 if entry.inViewport
  const viewBoost = entry.inViewport ? 0.03 : 0;

  // disabledPenalty = -0.50 if !entry.enabled
  const disabledPenalty = !entry.enabled ? -0.5 : 0;

  const rawTotal =
    base + prefixBoost + roleBoost + verbBoost + viewBoost + disabledPenalty;
  const total = Math.max(0, Math.min(1, Math.round(rawTotal * 10000) / 10000));

  return {
    base,
    prefixBoost,
    roleBoost,
    verbBoost,
    viewBoost,
    disabledPenalty,
    total,
  };
}
