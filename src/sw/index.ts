import { isEnvelopeFor } from "../shared/contracts";

/**
 * SPEC 8.7 `scripting`: re-inject the content script into every already-open
 * tab this extension can script. Without this, the demo breaks after every
 * `pnpm build` until every open tab is reloaded by hand.
 */
const CONTENT_SCRIPT_FILE = "src/content/index.js";

async function reinjectContentScript(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: "<all_urls>" });
  await Promise.all(
    tabs
      .filter((tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === "number")
      .map((tab) =>
        chrome.scripting
          .executeScript({ target: { tabId: tab.id }, files: [CONTENT_SCRIPT_FILE] })
          .catch(() => {
            // Tabs this extension cannot script into (chrome://, the Web
            // Store, another extension's page) are expected to reject; that
            // is not a failure worth surfacing.
          })
      )
  );
}

chrome.runtime.onInstalled.addListener(() => {
  void reinjectContentScript();
});

/**
 * SPEC 5.15 `[REQUIREMENT]`: every listener returns early if the envelope's
 * `ns` or `target` does not match. Handling for each message `type` (SPEC
 * 5.16) lands with the task that owns it; this shell only enforces the
 * envelope contract.
 */
chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!isEnvelopeFor(message, "sw")) return undefined;
  return undefined;
});
