/**
 * Global (browser-level) voice commands — SPEC 6.18, TASKS T1-08 (F-15).
 *
 *   "new tab"                → chrome.tabs.create({})
 *   "close tab"              → chrome.tabs.remove(active)
 *   "next/previous tab"      → neighbouring tab in the same window, wrapping
 *   "switch to <name> tab"   → best title/URL match among open tabs
 *   "go back/forward"        → chrome.tabs.goBack / goForward
 *   "reload" / "refresh"     → chrome.tabs.reload
 *   "search for <query>"     → Google search in a new tab (HD-04)
 *   "save this page"         → Google Keep note with the page title and URL (DEV-006)
 *
 * SPEC 6.18: these are resolved from a fixed intent table before any element
 * matching, and never reach the model. `matchGlobalIntent` is the router and is
 * pure; `runGlobalIntent` performs the chrome.tabs work and returns the one
 * sentence to speak. The pipeline owns the state machine and the speaking.
 *
 * Every URL opened here is built from a compile-time template plus
 * encodeURIComponent of a transcript- or tab-derived string. Nothing is taken
 * from model output (SPEC 6.18 requirement).
 */

import {
  GLOBAL_SPOKEN_NAME_MAX_CHARS,
  KEEP_NOTE_TEMPLATE,
  SEARCH_TEMPLATE,
  TAB_MATCH_THRESHOLD,
} from "../../shared/constants";
import { cleanText } from "../../shared/normalize";
import { tokenSetRatio } from "../resolver/score";
import { rememberTab, resolveTab } from "../active-tab";

// ---------------------------------------------------------------------------
// Intent table
// ---------------------------------------------------------------------------

export type GlobalIntent =
  | { kind: "new_tab" }
  | { kind: "close_tab" }
  | { kind: "cycle_tab"; direction: 1 | -1 }
  /** `soft`: no "tab" in the phrase ("switch to Wikipedia"), so it only counts if a tab matches. */
  | { kind: "switch_tab"; query: string; soft?: boolean }
  | { kind: "history"; direction: "back" | "forward" }
  | { kind: "reload" }
  | { kind: "search"; query: string }
  | { kind: "save_page" };

const LEADING_FILLER = /^(?:(?:please|can you|could you|would you|will you|hey|ok|okay|um|uh)\s+)+/i;

const NEW_TAB = /^(?:(?:open|create|make|start)\s+)?(?:a\s+|another\s+)?new\s+tab$|^open\s+(?:a\s+|another\s+)tab$/i;
const CLOSE_TAB = /^(?:close|shut)\s+(?:(?:this|the|my|current)\s+)*tab$/i;
const NEXT_TAB = /^(?:(?:go|switch|jump|move)\s+to\s+(?:the\s+)?)?next\s+tab$/i;
const PREVIOUS_TAB = /^(?:(?:go|switch|jump|move)\s+to\s+(?:the\s+)?)?(?:previous|prior|last)\s+tab$/i;
// A bare "back" or "forward" is left to the page: many pages have a Back button.
const GO_BACK = /^(?:go|navigate)\s+back(?:\s+(?:a|one)\s+page)?$|^(?:previous|last)\s+page$/i;
const GO_FORWARD = /^(?:go|navigate)\s+forward(?:\s+(?:a|one)\s+page)?$/i;
const RELOAD = /^(?:reload|refresh)(?:\s+(?:the|this))?(?:\s+page)?$/i;
const SWITCH_TAB = [
  /^(?:switch|go|jump|change|move|flip)\s+(?:back\s+)?to\s+(?:the\s+|my\s+)?(.+?)\s+tab$/i,
  /^(?:switch|go|jump|change|move)\s+to\s+(?:the\s+)?tab\s+(?:called\s+|named\s+|with\s+)?(.+)$/i,
];
// "switch to Wikipedia" / "switch to the airport page": no "tab" spoken, so the pipeline
// treats it as a tab switch only when an open tab really matches, else it is a page command.
const SWITCH_SOFT =
  /^(?:switch|flip|jump)\s+(?:back\s+)?to\s+(?:the\s+|my\s+)?(.+?)(?:\s+(?:page|window|site|website))?$/i;
// "search flights" must stay a click on the demo page's Search button, so a
// search intent always needs "for" (or "look up").
const SEARCH = [
  /^(?:(?:web|google)\s+)?search\s+(?:(?:google|the\s+web|the\s+internet|online)\s+)?for\s+(.+)$/i,
  /^look\s+up\s+(.+)$/i,
];
// "save" alone is a button on many pages, so a save intent needs a page
// reference ("this", "page", "keep", ...) or the word "bookmark" plus one.
const SAVE_PAGE =
  /^(?:save|bookmark|keep)(?:\s+(?:this|the|current))?(?:\s+(?:page|tab|site|link|url))?(?:\s+(?:to|in|on|into)\s+(?:my\s+)?(?:google\s+)?keep)?$/i;
const SAVE_VERB = /^(?:save|bookmark|keep)(?![a-z])/i;
const SAVE_ANCHOR = /\b(?:this|the|current|page|tab|site|link|url|keep)\b/i;

/**
 * Map a final transcript to a global intent, or null when it is not one (the
 * transcript then goes to the element resolver). Matching is anchored to the
 * whole utterance so page-content commands that merely contain these words
 * ("click the new tab button") are left alone.
 */
export function matchGlobalIntent(transcript: string): GlobalIntent | null {
  const text = transcript
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?,;:]+$/, "")
    .replace(LEADING_FILLER, "")
    .trim();
  if (text.length === 0) return null;

  if (NEW_TAB.test(text)) return { kind: "new_tab" };
  if (CLOSE_TAB.test(text)) return { kind: "close_tab" };
  // Before SWITCH_TAB, which would otherwise read "next" as a tab's name.
  if (NEXT_TAB.test(text)) return { kind: "cycle_tab", direction: 1 };
  if (PREVIOUS_TAB.test(text)) return { kind: "cycle_tab", direction: -1 };
  if (GO_BACK.test(text)) return { kind: "history", direction: "back" };
  if (GO_FORWARD.test(text)) return { kind: "history", direction: "forward" };
  if (RELOAD.test(text)) return { kind: "reload" };

  for (const pattern of SWITCH_TAB) {
    const query = pattern.exec(text)?.[1]?.trim();
    if (query) return { kind: "switch_tab", query };
  }

  const soft = SWITCH_SOFT.exec(text)?.[1]?.trim();
  if (soft) return { kind: "switch_tab", query: soft, soft: true };

  for (const pattern of SEARCH) {
    const query = pattern.exec(text)?.[1]?.trim();
    if (query) return { kind: "search", query };
  }

  if (SAVE_PAGE.test(text) && SAVE_ANCHOR.test(text.replace(SAVE_VERB, ""))) {
    return { kind: "save_page" };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tab matching ("switch to <name> tab")
// ---------------------------------------------------------------------------

export interface TabLike {
  id?: number;
  windowId?: number;
  title?: string;
  url?: string;
  lastAccessed?: number;
}

function hostAndPath(url: string | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return `${u.hostname} ${u.pathname}`;
  } catch {
    return url;
  }
}

/** Similarity in [0,1] between a spoken tab name and one tab's title or URL. */
export function scoreTab(query: string, tab: TabLike): number {
  const q = cleanText(query);
  if (!q) return 0;
  const title = cleanText(tab.title ?? "");
  const address = cleanText(hostAndPath(tab.url));

  let best = Math.max(tokenSetRatio(q, title), tokenSetRatio(q, address));
  // "you tube" / "gmail" against "youtube.com" / "mail.google.com": containment
  // beats token overlap when the recognizer splits or joins words.
  const squashed = q.replace(/\s+/g, "");
  if (squashed.length >= 3) {
    if (title.replace(/\s+/g, "").includes(squashed) || address.replace(/\s+/g, "").includes(squashed)) {
      best = Math.max(best, 0.95);
    }
  }
  return best;
}

export interface TabMatch {
  tab: TabLike;
  score: number;
}

/**
 * Best tab for a spoken name, or null when nothing reaches TAB_MATCH_THRESHOLD.
 * Ties go to the most recently used tab, so "switch to google tab" prefers the
 * one the user was last on.
 */
export function matchTab(query: string, tabs: TabLike[]): TabMatch | null {
  let best: TabMatch | null = null;
  for (const tab of tabs) {
    if (typeof tab.id !== "number") continue;
    const score = scoreTab(query, tab);
    if (score < TAB_MATCH_THRESHOLD) continue;
    if (
      !best ||
      score > best.score + 1e-9 ||
      (Math.abs(score - best.score) <= 1e-9 && (tab.lastAccessed ?? 0) > (best.tab.lastAccessed ?? 0))
    ) {
      best = { tab, score };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface GlobalResult {
  ok: boolean;
  /** The one sentence to speak (SPEC 6.19). */
  sentence: string;
}

function spoken(s: string): string {
  return s.length > GLOBAL_SPOKEN_NAME_MAX_CHARS ? s.slice(0, GLOBAL_SPOKEN_NAME_MAX_CHARS) : s;
}

/** Substitute into a `%s` template. A function replacer keeps `$` sequences literal. */
export function fillTemplate(template: string, text: string): string {
  return template.replace("%s", () => encodeURIComponent(text));
}

/** After the tab we spoke in is gone, speech is routed to whichever tab is now in front. */
async function retargetToActiveTab(windowId: number | undefined): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query(
      typeof windowId === "number" ? { active: true, windowId } : { active: true, lastFocusedWindow: true }
    );
    await rememberTab(tab?.id);
  } catch {
    // Speech falls back to chrome.tts or the active-tab query.
  }
}

/** Perform one global intent. Never throws: failures come back as a sentence. */
export async function runGlobalIntent(intent: GlobalIntent): Promise<GlobalResult> {
  try {
    switch (intent.kind) {
      case "new_tab": {
        await chrome.tabs.create({});
        return { ok: true, sentence: "Opening new tab." };
      }

      case "close_tab": {
        const tab = await resolveTab();
        if (!tab || typeof tab.id !== "number") {
          return { ok: false, sentence: "I can't find a tab to close." };
        }
        await chrome.tabs.remove(tab.id);
        await retargetToActiveTab(tab.windowId);
        return { ok: true, sentence: "Closing tab." };
      }

      case "cycle_tab": {
        const current = await resolveTab();
        if (!current || typeof current.id !== "number") {
          return { ok: false, sentence: "I can't find a tab to switch to." };
        }
        const tabs = (await chrome.tabs.query({ windowId: current.windowId })).sort(
          (a, b) => a.index - b.index
        );
        const at = tabs.findIndex((t) => t.id === current.id);
        if (tabs.length < 2 || at < 0) return { ok: false, sentence: "There's no other tab." };
        const next = tabs[(at + intent.direction + tabs.length) % tabs.length];
        if (typeof next.id !== "number") return { ok: false, sentence: "There's no other tab." };
        await chrome.tabs.update(next.id, { active: true });
        await rememberTab(next.id);
        return { ok: true, sentence: next.title ? `${spoken(next.title)}.` : "Switched tab." };
      }

      case "history": {
        const tab = await resolveTab();
        if (!tab || typeof tab.id !== "number") return { ok: false, sentence: "I can't read this page." };
        try {
          if (intent.direction === "back") await chrome.tabs.goBack(tab.id);
          else await chrome.tabs.goForward(tab.id);
        } catch {
          // SPEC 6.18: goBack rejects when there is no history.
          return {
            ok: false,
            sentence:
              intent.direction === "back" ? "There's nothing to go back to." : "There's nothing to go forward to.",
          };
        }
        return { ok: true, sentence: intent.direction === "back" ? "Going back." : "Going forward." };
      }

      case "reload": {
        const tab = await resolveTab();
        if (!tab || typeof tab.id !== "number") return { ok: false, sentence: "I can't read this page." };
        await chrome.tabs.reload(tab.id);
        return { ok: true, sentence: "Reloading." };
      }

      case "switch_tab": {
        const [tabs, current] = await Promise.all([chrome.tabs.query({}), resolveTab()]);
        const found = matchTab(intent.query, tabs);
        if (!found || typeof found.tab.id !== "number") {
          return { ok: false, sentence: `I couldn't find a tab called ${spoken(intent.query)}.` };
        }
        const name = spoken(found.tab.title || intent.query);
        if (current?.id === found.tab.id) {
          return { ok: true, sentence: `You're already on ${name}.` };
        }
        await chrome.tabs.update(found.tab.id, { active: true });
        if (typeof found.tab.windowId === "number") {
          await chrome.windows.update(found.tab.windowId, { focused: true }).catch(() => {});
        }
        await rememberTab(found.tab.id);
        return { ok: true, sentence: `Switching to ${name}.` };
      }

      case "search": {
        await chrome.tabs.create({ url: fillTemplate(SEARCH_TEMPLATE, intent.query) });
        return { ok: true, sentence: `Searching Google for ${spoken(intent.query)}.` };
      }

      case "save_page": {
        const tab = await resolveTab();
        if (!tab?.url) return { ok: false, sentence: "I can't read this page." };
        const note = tab.title ? `${tab.title}\n${tab.url}` : tab.url;
        await chrome.tabs.create({ url: fillTemplate(KEEP_NOTE_TEMPLATE, note) });
        // Keep is opened with the note text pre-filled; the sentence claims only that.
        return { ok: true, sentence: "Opening Keep with this page." };
      }
    }
  } catch (err) {
    console.warn("[ECHO SW] global command failed:", intent.kind, err instanceof Error ? err.message : err);
    return { ok: false, sentence: "Something went wrong." };
  }
}
