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
import { getAudioContext, playProcessingTick } from "./audio-stubs";
import { clearHighlights, highlightCandidates } from "./highlight";
import { reResolveElement } from "./reresolve";
import { extractPageText, type PageText } from "./page-text";
import { PAGE_TEXT_QA_MAX_CHARS } from "../shared/constants";

let activeTtsSource: AudioBufferSourceNode | null = null;

/**
 * Bumped by every tts.stop and every tts.play. A tts.play remembers the value it
 * started with; if it changed by the time decoding finishes, playback was
 * cancelled (or superseded) in the meantime and the clip must not start. Without
 * this, a stop that arrives during decodeAudioData finds no source to stop and
 * the confirmation then plays over the user who just interrupted it.
 */
let ttsEpoch = 0;

// Cached index per SPEC 6.5 (under 1500 ms and not invalidated by mutation)
let cachedIndex: ElementIndex | null = null;
let lastIndexTime = 0;

/**
 * Content signature of an index: what a resolved command or a pinned
 * clarification actually depends on. Layout jitter is deliberately excluded.
 */
function indexSignature(index: ElementIndex): string {
  return index.entries
    .map((e) => `${e.id}|${e.role}|${e.nameKey}|${e.enabled ? 1 : 0}|${e.value ?? ""}`)
    .join("\n");
}

export function getOrBuildIndex(force = false): ElementIndex {
  const now = Date.now();
  if (!force && cachedIndex && now - lastIndexTime < 1500) {
    return cachedIndex;
  }
  const next = buildElementIndex(document);
  // SPEC 12.9 gives every rebuild a new buildId so stale requests are rejected.
  // A rebuild of an unchanged page is not a change: keeping the id lets a
  // clarification survive the seconds it takes the user to answer.
  if (cachedIndex && indexSignature(next) === indexSignature(cachedIndex)) {
    next.buildId = cachedIndex.buildId;
  }
  cachedIndex = next;
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

      // Handle ui.highlight (SPEC 5.16): candidate highlight during clarification,
      // and an empty id list to clear every highlight (F-09, on IDLE).
      if (message.type === "ui.highlight") {
        const payload = message.payload as { ids?: string[]; durationMs?: number } | undefined;
        const ids = payload?.ids ?? [];
        clearHighlights(document);
        if (ids.length > 0) {
          const index = getOrBuildIndex(false);
          const elements = ids
            .map((id) => index.entries.find((e) => e.id === id))
            .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
            .map((entry) => reResolveElement(entry, document))
            .filter((el): el is Element => el !== null);
          const clear = highlightCandidates(elements);
          if (payload?.durationMs && payload.durationMs > 0) {
            setTimeout(clear, payload.durationMs);
          }
        }
        sendResponse({ ok: true });
        return true;
      }

      // Handle page.text (SPEC 11.6 / 11.7): readable text for a spoken summary or answer.
      if (message.type === "page.text") {
        const payload = message.payload as { maxChars?: number } | undefined;
        const maxChars = Math.min(Math.max(payload?.maxChars ?? 0, 0) || PAGE_TEXT_QA_MAX_CHARS, PAGE_TEXT_QA_MAX_CHARS);
        const response: Envelope<PageText> = {
          ns: ENVELOPE_NS,
          target: "sw",
          type: "page.text",
          reqId: message.reqId,
          payload: extractPageText(document, maxChars),
        };
        sendResponse(response);
        return true;
      }

      // Handle audio.play (SPEC 5.16): the "still working" tick while the service
      // worker waits on the model. Only that cue is accepted here; the positional
      // execution ticks are played by the executor itself.
      if (message.type === "audio.play") {
        const payload = message.payload as { kind?: string } | undefined;
        if (payload?.kind === "processing") void playProcessingTick();
        sendResponse({ ok: true });
        return true;
      }

      // Handle tts.play (HD-A06 dual-engine ElevenLabs playback)
      if (message.type === "tts.play") {
        const payload = message.payload as { audioBase64?: string } | undefined;
        if (!payload?.audioBase64) {
          sendResponse({ ok: false, error: "Missing audioBase64" });
          return false;
        }

        const ctx = getAudioContext();
        if (!ctx) {
          sendResponse({ ok: false, error: "AudioContext unavailable" });
          return false;
        }

        const epoch = ++ttsEpoch;
        void (async () => {
          try {
            if (ctx.state === "suspended") {
              await ctx.resume();
            }

            // Stop any currently playing TTS source
            if (activeTtsSource) {
              try {
                activeTtsSource.stop();
              } catch {
                // Ignore errors from already stopped sources
              }
              activeTtsSource = null;
            }

            const binaryString = atob(payload.audioBase64!);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }

            const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
            if (epoch !== ttsEpoch) {
              // Stopped (or replaced) while decoding: never start.
              sendResponse({ ok: true, cancelled: true });
              return;
            }
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(ctx.destination);
            activeTtsSource = source;

            // The response is sent when playback ends (or is stopped), so the
            // service worker can tell "still speaking" from "done".
            source.onended = () => {
              if (activeTtsSource === source) {
                activeTtsSource = null;
              }
              sendResponse({ ok: true });
            };

            source.start(0);
          } catch (err) {
            console.warn("[ECHO] Failed to decode/play ElevenLabs audio:", err);
            sendResponse({ ok: false, error: String(err) });
          }
        })();
        return true;
      }

      // Handle tts.stop (SPEC §10.6.4 interruption)
      if (message.type === "tts.stop") {
        ttsEpoch++;
        if (activeTtsSource) {
          try {
            activeTtsSource.stop();
          } catch {
            // Ignore errors from already stopped sources
          }
          activeTtsSource = null;
        }
        sendResponse({ ok: true });
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
