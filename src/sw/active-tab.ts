/**
 * The tab a command runs in. The user pressed the hold key in that tab, so it
 * is remembered per key.down rather than re-derived from "the active tab" at
 * resolution time (the user may have moved on by then).
 *
 * Shared by the pipeline and the global (browser) commands.
 */

import { ACTIVE_TAB_KEY } from "../shared/constants";

/** Remember the tab the user pressed the key in: that is where the command runs. */
export async function rememberTab(tabId: number | undefined): Promise<void> {
  if (typeof tabId !== "number") return;
  await chrome.storage.session.set({ [ACTIVE_TAB_KEY]: tabId }).catch(() => {});
}

/** The remembered tab if it still exists, else the focused window's active tab. */
export async function resolveTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const stored = await chrome.storage.session.get(ACTIVE_TAB_KEY);
    const remembered = stored?.[ACTIVE_TAB_KEY];
    if (typeof remembered === "number") {
      return await chrome.tabs.get(remembered); // throws if the tab is gone
    }
  } catch {
    // fall through to the active-tab query
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab && typeof tab.id === "number" ? tab : null;
}

export async function resolveTabId(): Promise<number | null> {
  return (await resolveTab())?.id ?? null;
}
