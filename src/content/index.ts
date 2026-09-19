import { isEnvelopeFor } from "../shared/contracts";

/**
 * SPEC 5.15 `[REQUIREMENT]`: every listener returns early if the envelope's
 * `ns` or `target` does not match. Handling for each message `type` (SPEC
 * 5.16) lands with the task that owns it; this shell only enforces the
 * envelope contract.
 */
chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!isEnvelopeFor(message, "content")) return undefined;
  return undefined;
});

// SPEC 16, F-01: the content script logs a single readiness line on inject.
console.log("[ECHO] content script ready");
