/**
 * Browser context for the model: the current date and time, the page the user is on,
 * and the tabs open in that window (HD-09, DEV-008).
 *
 * It travels in its own user content part, never in the system instruction: tab
 * titles are page-derived, and SPEC 8.2 keeps page-derived strings out of the
 * system instruction. Only a title and a hostname are sent for each tab, never a
 * full URL (SPEC 8.3).
 */

import { CONTEXT_MAX_TABS, CONTEXT_TITLE_MAX_CHARS } from "../../shared/constants";
import { sanitizeForPrompt } from "../../shared/normalize";

export interface ContextTab {
  /** 1-based position in the window, as the user hears and says it. */
  n: number;
  title: string;
  host: string;
  /** The tab the request is about. */
  current: boolean;
}

export interface BrowserContext {
  /** "Saturday, September 19, 2026 at 2:32 PM EDT" */
  now: string;
  /** The tab the request is about (null when it cannot be read). `host` is only sent to the answer call. */
  page: { title: string; host?: string } | null;
  /** Only sent to the answer call. */
  tabs?: ContextTab[];
  /** Set when the command clicked something first and the answer is about what loaded. */
  justNavigatedFrom?: string;
}

/** Human-readable local date and time, e.g. "Saturday, September 19, 2026 at 2:32 PM EDT". */
export function formatNow(date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    })
      .format(date)
      .replace(/,\s(?=\d{1,2}:\d{2})/, " at ");
  } catch {
    return date.toISOString();
  }
}

export function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

interface TabLike {
  id?: number;
  index?: number;
  windowId?: number;
  title?: string;
  url?: string;
  active?: boolean;
}

/**
 * What a call may know. The answer call (a question about the page, with page text
 * already leaving the browser, HD-09) gets hostnames and the window's tab list. The
 * element resolver gets the date, the time and the page's title, and nothing else.
 */
export type ContextScope = "answer" | "resolver";

/** Pure: turn a tab list into the context the model sees. */
export function buildBrowserContext(
  tabs: TabLike[],
  activeTabId: number | null,
  now: Date = new Date(),
  justNavigatedFrom?: string,
  scope: ContextScope = "answer"
): BrowserContext {
  const ordered = [...tabs].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const described: ContextTab[] = ordered.slice(0, CONTEXT_MAX_TABS).map((t, i) => ({
    n: i + 1,
    title: sanitizeForPrompt(t.title ?? "", CONTEXT_TITLE_MAX_CHARS),
    host: hostOf(t.url),
    current: t.id === activeTabId,
  }));
  const current = ordered.find((t) => t.id === activeTabId);
  const context: BrowserContext = {
    now: formatNow(now),
    page: current
      ? {
          title: sanitizeForPrompt(current.title ?? "", CONTEXT_TITLE_MAX_CHARS),
          // The element resolver never sees an address, only a title (SPEC 8.3, security test D6).
          ...(scope === "answer" ? { host: hostOf(current.url) } : {}),
        }
      : null,
  };
  if (scope === "answer") context.tabs = described;
  if (justNavigatedFrom) {
    context.justNavigatedFrom = sanitizeForPrompt(justNavigatedFrom, CONTEXT_TITLE_MAX_CHARS);
  }
  return context;
}

/** The text of the `<browser_context>` part. */
export function formatBrowserContext(context: BrowserContext): string {
  return `<browser_context>${JSON.stringify(context)}</browser_context>`;
}

/**
 * Read the window's tabs and describe them. Never throws: a context that cannot
 * be gathered is just the date and time.
 */
export async function gatherBrowserContext(
  tabId: number | null,
  options: { justNavigatedFrom?: string; scope?: ContextScope } = {}
): Promise<BrowserContext> {
  try {
    let windowId: number | undefined;
    if (tabId !== null) {
      windowId = (await chrome.tabs.get(tabId)).windowId;
    }
    const tabs = await chrome.tabs.query(typeof windowId === "number" ? { windowId } : { currentWindow: true });
    return buildBrowserContext(tabs, tabId, new Date(), options.justNavigatedFrom, options.scope ?? "answer");
  } catch {
    return { now: formatNow(), page: null };
  }
}
