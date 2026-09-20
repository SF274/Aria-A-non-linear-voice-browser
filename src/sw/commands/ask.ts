/**
 * Question routing — SPEC 11.6 / 11.7, 6.14, 6.15 (F-13, F-14).
 *
 * Decides whether an utterance is a request to be told something ("what's on this
 * page", "who wrote this", "what tabs are open") rather than a command to act on
 * the page, and splits "click the first link and tell me where it leads" into the
 * action and the question. Pure, so every phrase is a unit test.
 *
 * The rules lean toward the command. A wrong action is worse than a wrong answer
 * (SPEC 7.4), so anything that reads as "click / fill / select ..." is left to the
 * element resolver, and a polite "can you click submit" is a command, not a question.
 */

import type { AnswerKind } from "../gemini/qa";

export interface AskRequest {
  kind: AnswerKind;
  /** What to answer, with any leading action removed. */
  question: string;
  /** A spoken tab name ("the airport page") when the question is about another tab. */
  tabQuery: string | null;
  /** Answerable from the date and open tabs alone; no page text is fetched. */
  contextOnly: boolean;
}

export interface AskRoute {
  /** The command to run first ("click the first link"), or null for a plain question. */
  action: string | null;
  ask: AskRequest;
}

const LEADING_FILLER = /^(?:(?:please|hey|ok|okay|um|uh|so|well|and)[\s,]+)+/i;
const POLITE = /^(?:can|could|would|will)\s+you\s+(?:please\s+)?/i;

/** "Summarize", "what's on this page", "where am I": a description of the page as a whole. */
const SUMMARY = [
  /\b(?:summari[sz]e|summary|overview|recap|sum\s+up)\b/i,
  /\bdescribe\b/i,
  /\bwhat(?:'s|s|\s+is|\s+are)?\s+(?:on|in)\s+(?:this|the|my|that)\s+(?:[\w'-]+\s+){0,3}?(?:page|screen|site|website|tab|article)\b/i,
  /\bwhat(?:'s|s|\s+is)\s+(?:this|that|the)\s+(?:page|site|website|article)(?:\s+about)?\b/i,
  /\bwhat(?:'s|s|\s+is)\s+(?:this|that)$/i,
  /\bwhat\s+(?:page|site|website)\s+(?:is\s+this|am\s+i\s+(?:on|looking\s+at))\b/i,
  /\bwhere\s+am\s+i\b/i,
  /\bwhat\s+am\s+i\s+(?:on|looking\s+at)\b/i,
  /\b(?:read|tell)\s+(?:me\s+)?(?:about\s+)?(?:this|the)\s+(?:page|article|site|website)\b/i,
];

/**
 * Answerable without reading any page: the date, the time, the open tabs. They
 * work on pages the extension cannot read (chrome://, the Web Store) and are faster.
 */
const CONTEXT_ONLY = [
  /\bwhat(?:'s|s|\s+is)\s+(?:the\s+|today'?s\s+)?(?:current\s+)?(?:date|time|day)(?:\s+(?:is\s+it|today|now|right\s+now))?$/i,
  /\bwhat\s+(?:time|day|date)\s+is\s+it(?:\s+(?:now|right\s+now|today))?$/i,
  /\bwhat\s+day\s+is\s+(?:it\s+)?today$/i,
  /\b(?:what|which)\s+tabs\b/i,
  /\bhow\s+many\s+tabs\b/i,
  /\blist\s+(?:my\s+|the\s+|all\s+)?tabs\b/i,
  /\bwhat(?:'s|s|\s+is)\s+open$/i,
  /\b(?:what|which)\s+(?:tab|page)\s+am\s+i\s+(?:on|in|looking\s+at)$/i,
];

/** "List my tabs": no question word, but it only asks to be told something. */
const LIST_TABS = /^(?:list|read|show)(?:\s+me)?\s+(?:my\s+|the\s+|all\s+)?(?:open\s+)?tabs$/i;

/** The start of a question or an ask-verb request. */
const QUESTION = [
  /^(?:what|what's|whats|who|who's|whose|when|where|where's|why|how|which)\b/i,
  /^(?:is|are|was|were)\s+(?:there|this|that|it|the|a|an|my|any|these|those)\b/i,
  /^(?:does|did)\s+(?:this|the|it|that|these|they|you|i|we|my)\b/i,
  // "do the booking" is a command; only "do you / do I ..." is a question.
  /^do\s+(?:you|i|we|they|these|those)\b/i,
  /^(?:can|could)\s+(?:i|we)\b/i,
  /^(?:tell\s+me|let\s+me\s+know|explain)\b/i,
  /^give\s+me\s+(?:a|the)\s+(?:summary|overview|rundown|gist)\b/i,
];

/** Where "..., and then tell me ..." begins the question half of a compound. */
const COMPOUND_SPLIT =
  /(?:,\s*|\s+)(?:and\s+(?:then\s+)?|then\s+)(?=(?:tell\s+me|let\s+me\s+know|read\s+(?:me|out|it|that|the|this)|describe|explain|summari[sz]e|what|where|who|how|which|give\s+me\s+(?:a|the)\s+(?:summary|overview)))/gi;

/** Words that mean "this page", not a tab called that. */
const GENERIC_TAB_WORDS = new Set([
  "this", "that", "these", "those", "current", "whole", "entire", "open", "web", "main", "next", "previous",
  "other", "same", "full", "home", "the", "my", "a", "an", "it", "first", "last", "page", "tab", "site",
]);
/** A captured "tab name" containing these is a stretch of the sentence, not a name. */
const NOT_A_TAB_NAME = new Set(["on", "in", "of", "at", "from", "about", "is", "are", "and", "to", "for", "with", "it"]);
const TAB_REFERENCES = [
  /\b(?:on|in|of|from|at|about)\s+(?:the\s+|my\s+)?(.+?)\s+(?:tab|page|window|site|website)\b/i,
  /\b(?:summari[sz]e|describe|read)\s+(?:me\s+)?(?:the\s+|my\s+)?(.+?)\s+(?:tab|page|window|site|website)\b/i,
];

function tidy(transcript: string): string {
  return transcript
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?,;:]+$/, "")
    .replace(LEADING_FILLER, "")
    .trim();
}

/** True when the whole utterance is a request to be told something. */
function askKind(text: string): AnswerKind | null {
  let t = text;
  const polite = POLITE.exec(t);
  if (polite) t = t.slice(polite[0].length);

  if (SUMMARY.some((re) => re.test(t))) {
    // "click the summary button" is a command; a question starts with a question word or ask-verb.
    if (QUESTION.some((re) => re.test(t)) || /^(?:summari[sz]e|describe|read|recap|overview|sum)\b/i.test(t)) {
      return "summary";
    }
    return null;
  }
  if (QUESTION.some((re) => re.test(t))) return "qa";
  return null;
}

function tabQueryOf(question: string): string | null {
  for (const pattern of TAB_REFERENCES) {
    const match = pattern.exec(question)?.[1];
    if (!match) continue;
    const all = match.toLowerCase().split(/\s+/).filter(Boolean);
    if (all.length > 4 || all.some((w) => NOT_A_TAB_NAME.has(w))) continue;
    const words = all.filter((w) => !GENERIC_TAB_WORDS.has(w));
    if (words.length > 0) return words.join(" ");
  }
  return null;
}

function toAsk(question: string, kind: AnswerKind): AskRequest {
  const contextOnly = CONTEXT_ONLY.some((re) => re.test(question));
  return { kind, question, tabQuery: contextOnly ? null : tabQueryOf(question), contextOnly };
}

/**
 * Words in the utterance once the question word is removed: a link named "What's
 * new" is two, "where is the submit button" is five. Short questions may be an
 * element's name, so the pipeline lets the local resolver try them first.
 */
export function isShortQuestion(question: string): boolean {
  return question.trim().split(/\s+/).filter(Boolean).length <= 3;
}

/**
 * Map a final transcript to a question, an action followed by a question, or null
 * (an ordinary command for the element resolver).
 */
export function matchAsk(transcript: string): AskRoute | null {
  const text = tidy(transcript);
  if (text.length === 0) return null;

  // "click the first link and tell me where it leads": the action runs first.
  COMPOUND_SPLIT.lastIndex = 0;
  const split = COMPOUND_SPLIT.exec(text);
  if (split && split.index > 0) {
    // "can you click the first link and ..." -> "click the first link"
    const action = text.slice(0, split.index).trim().replace(POLITE, "");
    const question = text.slice(split.index + split[0].length).trim();
    if (action && question && askKind(action) === null) {
      const kind = askKind(question) ?? "qa";
      return { action, ask: toAsk(question, kind) };
    }
  }

  const kind = askKind(text) ?? (LIST_TABS.test(text) ? "qa" : null);
  if (kind === null) return null;
  const polite = POLITE.exec(text);
  return { action: null, ask: toAsk(polite ? text.slice(polite[0].length) : text, kind) };
}
