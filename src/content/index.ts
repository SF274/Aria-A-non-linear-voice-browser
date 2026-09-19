import {
  type ElementIndex,
  type Envelope,
  type ExecuteRequest,
  type ExecuteResult,
  ENVELOPE_NS,
  isEnvelopeFor,
} from "../shared/contracts";
import { executeRequest } from "./executor";
import { buildElementIndex } from "./index-builder";
import { createIndexObserver } from "./observer";
import { initHoldToTalk } from "./hold-to-talk";

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

      // Handle exec.run (SPEC 5.16, SPEC 7.6.3)
      if (message.type === "exec.run") {
        const payload = message.payload as ExecuteRequest;
        executeRequest(payload, { buildIndexFn: getOrBuildIndex })
          .then((result) => {
            const response: Envelope<ExecuteResult> = {
              ns: ENVELOPE_NS,
              target: "sw",
              type: "exec.run",
              reqId: message.reqId,
              payload: result,
            };
            sendResponse(response);
          })
          .catch((err) => {
            const errorResult: ExecuteResult = {
              ok: false,
              completed: 0,
              failedAtIndex: 0,
              results: [
                {
                  index: 0,
                  verb: payload?.actions?.[0]?.verb || "click",
                  elementId: payload?.actions?.[0]?.elementId || "",
                  resolvedName: null,
                  status: "error",
                  detail: err instanceof Error ? err.message : String(err),
                },
              ],
            };
            const response: Envelope<ExecuteResult> = {
              ns: ENVELOPE_NS,
              target: "sw",
              type: "exec.run",
              reqId: message.reqId,
              payload: errorResult,
            };
            sendResponse(response);
          });
        return true;
      }

      return undefined;
    }
  );
}

// Initialize hold-to-talk on page load (SPEC §6.1).
if (typeof window !== "undefined") {
  initHoldToTalk();
}

declare global {
  interface Window {
    __ECHO_BUILD_INDEX__?: typeof buildElementIndex;
    __ECHO_GET_INDEX__?: typeof getOrBuildIndex;
    __ECHO_EXECUTE_REQUEST__?: typeof executeRequest;
  }
}

// Expose on global window for e2e testing and inspection
if (typeof window !== "undefined") {
  window.__ECHO_BUILD_INDEX__ = buildElementIndex;
  window.__ECHO_GET_INDEX__ = getOrBuildIndex;
  window.__ECHO_EXECUTE_REQUEST__ = executeRequest;
}

// SPEC 16, F-01: the content script logs a single readiness line on inject.
console.log("[ECHO] content script ready");
