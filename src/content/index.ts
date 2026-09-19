import {
  type ElementIndex,
  type Envelope,
  ENVELOPE_NS,
  isEnvelopeFor,
} from "../shared/contracts";
import { buildElementIndex } from "./index-builder";
import { createIndexObserver } from "./observer";

// Cached index per SPEC 6.5 (under 1500 ms and not invalidated by mutation)
let cachedIndex: ElementIndex | null = null;
let lastIndexTime = 0;

export function getOrBuildIndex(force = false): ElementIndex {
  const now = Date.now();
  if (!force && cachedIndex && now - lastIndexTime < 1500) {
    return cachedIndex;
  }
  cachedIndex = buildElementIndex(document);
  lastIndexTime = now;
  return cachedIndex;
}

// Start mutation observer on page load per SPEC 12.9
if (typeof document !== "undefined") {
  try {
    createIndexObserver({
      onIndexChanged: (_event, newIndex) => {
        cachedIndex = newIndex;
        lastIndexTime = Date.now();
      },
    });
  } catch (err) {
    console.warn("[ECHO] Failed to initialize mutation observer:", err);
  }
}

/**
 * SPEC 5.15 & 5.16 message handler for the content script.
 */
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse) => {
      if (!isEnvelopeFor(message, "content")) return undefined;

      // Handle index.get (SPEC 5.16, SPEC 6.5)
      if (message.type === "index.get") {
        const payload = message.payload as { force?: boolean } | undefined;
        const index = getOrBuildIndex(Boolean(payload?.force));
        const response: Envelope<ElementIndex> = {
          ns: ENVELOPE_NS,
          target: "sw",
          type: "index.get",
          reqId: message.reqId,
          payload: index,
        };
        sendResponse(response);
        return true;
      }

      return undefined;
    }
  );
}

declare global {
  interface Window {
    __ECHO_BUILD_INDEX__?: typeof buildElementIndex;
    __ECHO_GET_INDEX__?: typeof getOrBuildIndex;
  }
}

// Expose on global window for e2e testing and inspection
if (typeof window !== "undefined") {
  window.__ECHO_BUILD_INDEX__ = buildElementIndex;
  window.__ECHO_GET_INDEX__ = getOrBuildIndex;
}

// SPEC 16, F-01: the content script logs a single readiness line on inject.
console.log("[ECHO] content script ready");
