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
import {
  clearAudioLog,
  followAudioSetting,
  getAudioContext,
  isMutationAudioEnabled,
  getAudioLog,
  beginActivity,
  endActivity,
} from "./audio/engine";
import { startMutationSonification } from "./audio/mutation";
import { playProcessingTick } from "./audio/transport";
import { clearHighlights, highlightCandidates } from "./highlight";
import { reResolveElement } from "./reresolve";
import { extractPageText, type PageText } from "./page-text";
import {
  PAGE_TEXT_QA_MAX_CHARS,
  TTS_FADE_IN_MS,
  TTS_FADE_OUT_MS,
  TTS_LIMITER,
  TTS_PLAYBACK_GAIN,
} from "../shared/constants";

/**
 * The currently playing ElevenLabs clip, with the GainNode it runs through.
 * The gain gives the clip a short fade in (a buffer started at full amplitude
 * cracks) and lets an interruption fade out instead of cutting to silence
 * mid-waveform. The limiter after it holds the hot opening below clipping.
 */
let activeTts: { source: AudioBufferSourceNode; gain: GainNode } | null = null;

/**
 * Bumped by every tts.stop and every tts.play. A tts.play remembers the value it
 * started with; if it changed by the time decoding finishes, playback was
 * cancelled (or superseded) in the meantime and the clip must not start. Without
 * this, a stop that arrives during decodeAudioData finds no source to stop and
 * the confirmation then plays over the user who just interrupted it.
 */
let ttsEpoch = 0;

/**
 * Stop the playing clip, fading out over TTS_FADE_OUT_MS first so the cut does
 * not land mid-waveform and click. Interruption is on every key.down
 * (SPEC 10.6.4), so this runs constantly and must stay silent about failure.
 * source.onended still fires after the scheduled stop, which answers tts.play.
 */
function stopActiveTts(): void {
  const playing = activeTts;
  if (!playing) return;
  activeTts = null;

  const { source, gain } = playing;
  try {
    const ctx = gain.context;
    const end = ctx.currentTime + TTS_FADE_OUT_MS / 1000;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    // Hold the level the fade-in had actually reached, then ramp down from it.
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, end);
    source.stop(end);
  } catch {
    // Context is dead or the source already stopped: cut it hard instead.
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
  }
}

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

/**
 * F-17 (SPEC 9.8): the page's own changes, made audible. Attached beside the
 * index observer rather than inside it, because the two answer different
 * questions — the index observer asks "what can be acted on now", the sonifier
 * asks "what just happened, and where". It rides on `index.changed` for the
 * structural layer and keeps its own counting observer for text churn, which
 * never reaches the index at all.
 */
let mutationSonifier: ReturnType<typeof startMutationSonification> | null = null;

// Start mutation observer on page load per SPEC 12.9
if (typeof document !== "undefined") {
  try {
    followAudioSetting();
    // HD-12: off unless `settings.mutationAudio` is explicitly true. The engine
    // and every test stay in place; the observer simply never attaches, so a
    // page that is not sonified also pays nothing for the feature.
    void isMutationAudioEnabled().then((enabled) => {
      if (enabled && !mutationSonifier) mutationSonifier = startMutationSonification();
    });
    createIndexObserver({
      onIndexChanged: (event, newIndex) => {
        cachedIndex = newIndex;
        lastIndexTime = Date.now();
        // Never let a cue break indexing: a throw here would take the observer
        // callback down with it (SPEC 9.6).
        try {
          mutationSonifier?.onIndexChanged(event, newIndex);
        } catch {
          // Degrade to silence.
        }
      },
    });
  } catch (err) {
    console.warn("[Aria] Failed to initialize mutation observer:", err);
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
        const payload = message.payload as { maxChars?: number; preserveParagraphs?: boolean } | undefined;
        const maxChars = Math.min(Math.max(payload?.maxChars ?? 0, 0) || PAGE_TEXT_QA_MAX_CHARS, PAGE_TEXT_QA_MAX_CHARS);
        const response: Envelope<PageText> = {
          ns: ENVELOPE_NS,
          target: "sw",
          type: "page.text",
          reqId: message.reqId,
          // HD-14: the service worker asks for paragraph breaks when the text is
          // also going to the synthetic-text classifier.
          payload: extractPageText(document, maxChars, {
            preserveParagraphs: payload?.preserveParagraphs === true,
          }),
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
        const payload = message.payload as { audioBase64?: string; pan?: number } | undefined;
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
            stopActiveTts();

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

            // Ramp up over TTS_FADE_IN_MS rather than starting at full level, so
            // the first sample does not click.
            const gain = ctx.createGain();
            const t0 = ctx.currentTime;
            gain.gain.setValueAtTime(0, t0);
            gain.gain.linearRampToValueAtTime(
              TTS_PLAYBACK_GAIN,
              t0 + TTS_FADE_IN_MS / 1000
            );

            // Brick-wall the peaks. The opening clause runs hot enough to clip
            // against the destination; normal speech sits under the threshold
            // and passes through at full level. See TTS_LIMITER.
            const limiter = ctx.createDynamicsCompressor();
            limiter.threshold.setValueAtTime(TTS_LIMITER.thresholdDb, t0);
            limiter.knee.setValueAtTime(TTS_LIMITER.kneeDb, t0);
            limiter.ratio.setValueAtTime(TTS_LIMITER.ratio, t0);
            limiter.attack.setValueAtTime(TTS_LIMITER.attackSec, t0);
            limiter.release.setValueAtTime(TTS_LIMITER.releaseSec, t0);

            // HD-12 ("spatial links"): place the voice where the thing it is
            // talking about actually is. The panner goes *after* the limiter so
            // the limiter still sees the whole signal and only decides level;
            // panning before it would let a hard-left clip duck a hard-right
            // one. A pan of 0 is the centre every other utterance uses, so the
            // node is only built when there is somewhere to put the voice.
            const pan = typeof payload.pan === "number" ? payload.pan : 0;
            source.connect(gain);
            gain.connect(limiter);
            if (pan !== 0 && typeof ctx.createStereoPanner === "function") {
              const panner = ctx.createStereoPanner();
              panner.pan.setValueAtTime(Math.min(1, Math.max(-1, pan)), t0);
              limiter.connect(panner);
              panner.connect(ctx.destination);
            } else {
              limiter.connect(ctx.destination);
            }
            activeTts = { source, gain };

            // The response is sent when playback ends (or is stopped), so the
            // service worker can tell "still speaking" from "done".
            source.onended = () => {
              if (activeTts?.source === source) {
                activeTts = null;
              }
              try {
                gain.disconnect();
                limiter.disconnect();
              } catch {
                // Already torn down.
              }
              sendResponse({ ok: true });
            };

            source.start(t0);
          } catch (err) {
            console.warn("[Aria] Failed to decode/play ElevenLabs audio:", err);
            sendResponse({ ok: false, error: String(err) });
          }
        })();
        return true;
      }

      // Handle tts.stop (SPEC §10.6.4 interruption)
      if (message.type === "tts.stop") {
        ttsEpoch++;
        stopActiveTts();
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

/**
 * What an e2e test can reach. A content script runs in an isolated world, so a
 * page cannot see any of this; the audio tests get at it by injecting the
 * bundle into the main world deliberately (see `test/e2e/mutation-audio.spec.ts`).
 * The audio log holds coordinates, frequencies and gains — never page content.
 */
declare global {
  interface Window {
    __ECHO_BUILD_INDEX__?: typeof buildElementIndex;
    __ECHO_GET_INDEX__?: typeof getOrBuildIndex;
    __ECHO_EXECUTE_REQUEST__?: typeof executeRequest;
    __ECHO_AUDIO__?: {
      log: typeof getAudioLog;
      clear: typeof clearAudioLog;
      beginActivity: typeof beginActivity;
      endActivity: typeof endActivity;
      /**
       * Start mutation sonification regardless of `settings.mutationAudio`.
       * The feature ships off (HD-12), and a test that had to write extension
       * storage to reach it would be testing the options page instead of the
       * sonifier.
       */
      startMutationAudio: () => void;
    };
  }
}

// Expose on global window for e2e testing and inspection
if (typeof window !== "undefined") {
  window.__ECHO_BUILD_INDEX__ = buildElementIndex;
  window.__ECHO_GET_INDEX__ = getOrBuildIndex;
  window.__ECHO_EXECUTE_REQUEST__ = executeRequest;
  window.__ECHO_AUDIO__ = {
    log: getAudioLog,
    clear: clearAudioLog,
    beginActivity,
    endActivity,
    startMutationAudio: () => {
      if (!mutationSonifier) mutationSonifier = startMutationSonification();
    },
  };
}

// SPEC 16, F-01: the content script logs a single readiness line on inject.
console.log("[Aria] content script ready");
