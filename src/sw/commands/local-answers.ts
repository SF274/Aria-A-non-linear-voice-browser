/**
 * Answers that need no model and no page: the date, the time, and what is open.
 *
 * "What time is it" works offline, on chrome:// pages, and costs nothing; "what tabs
 * are open" is read from chrome.tabs rather than paraphrased by a model that could
 * get a title wrong. Pure: the caller passes the context and the clock.
 */

import type { BrowserContext } from "../gemini/context";

/** How many tab titles are read out before "and N more". */
const MAX_TABS_SPOKEN = 6;

function timeText(now: Date): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(now);
}

function dateText(now: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The spoken answer to a context-only question. Never throws. */
export function answerFromContext(question: string, context: BrowserContext, now: Date = new Date()): string {
  const q = question.toLowerCase();
  const tabs = context.tabs ?? [];

  if (/\b(?:time|date|day)\b/.test(q) && !/\btabs?\b/.test(q)) {
    const wantsTime = /\btime\b/.test(q);
    const wantsDate = /\b(?:date|day)\b/.test(q);
    if (wantsTime && !wantsDate) return `It's ${timeText(now)}.`;
    if (wantsDate && !wantsTime) return `Today is ${dateText(now)}.`;
    return `It's ${timeText(now)} on ${dateText(now)}.`;
  }

  if (/\bhow\s+many\s+tabs\b/.test(q)) {
    return tabs.length === 0 ? "I can't see your tabs." : `You have ${plural(tabs.length, "tab")} open.`;
  }

  if (/\b(?:tab|page)\s+am\s+i\b/.test(q)) {
    const page = context.page;
    if (!page || (!page.title && !page.host)) return "I can't tell which page you're on.";
    const name = page.title || page.host;
    return page.host && page.title ? `You're on ${name}, at ${page.host}.` : `You're on ${name}.`;
  }

  // "what tabs are open", "list my tabs", "what's open"
  if (tabs.length === 0) return "I can't see your tabs.";
  const spoken = tabs.slice(0, MAX_TABS_SPOKEN).map((t) => {
    const name = t.title || t.host || "untitled";
    return `${t.n}, ${name}${t.current ? ", this one" : ""}.`;
  });
  const more = tabs.length - spoken.length;
  return [`You have ${plural(tabs.length, "tab")} open.`, ...spoken, more > 0 ? `And ${more} more.` : ""]
    .filter(Boolean)
    .join(" ");
}
