/**
 * Command pipeline — SPEC 4.5, 6.4–6.12, 7.4–7.7, 11.4.
 *
 *   transcript → normalize → page index → tier one (local) → tier two (Gemini)
 *              → confidence gate → validation → exec.run → spoken confirmation
 *
 * Owned by the service worker (SPEC 4.6: "Choosing the target element" and
 * "Transcript interpretation" never belong to the content script or the
 * model). Every path ends in a spoken sentence and a return to IDLE, or in
 * CLARIFYING; none hangs (SPEC 6.19).
 */

import {
  CLARIFY_TIMEOUT_MS,
  PROCESSING_TICK_FIRST_MS,
  PROCESSING_TICK_INTERVAL_MS,
  PROCESSING_TICK_MAX,
  SEQUENCE_STEP_DELAY_MS,
} from "../shared/constants";
import {
  type Action,
  type ClarificationState,
  CLARIFY_QUESTION_MAX_CHARS,
  ENVELOPE_NS,
  type ElementIndex,
  type ElementIndexEntry,
  type Envelope,
  type ExecuteRequest,
  type ExecuteResult,
  type ResolveMode,
  type Settings,
  TRANSCRIPT_MAX_CHARS,
  type Verbosity,
} from "../shared/contracts";
import { normalizeTranscript, type NormalizedTranscript } from "../shared/normalize";
import { rememberTab, resolveTabId } from "./active-tab";
import { matchGlobalIntent, runGlobalIntent, type GlobalIntent } from "./commands/browser";
import { VALIDATION_REFUSAL_PHRASE, validateExecuteRequest } from "./execute/validate";
import { resolveWithGemini } from "./gemini/resolver";
import { toPromptElements } from "./gemini/prompts";
import { formatClarifyingQuestion, inDocumentOrder, resolveClarificationReply } from "./resolver/clarify";
import { resolveLocal } from "./resolver/local";
import { getSession, onTransition, transitionTo } from "./session";
import { speakFromSettings, formatConfirmation, type ConfirmationSituation } from "./tts";

const CONTENT_MESSAGE_TIMEOUT_MS = 500;
const EXEC_TIMEOUT_MS = 15_000;
const MAX_SPOKEN_WAIT_MS = 30_000;

/** Roles a bare "name" command clicks; everything else is focused (SPEC 7.2.2). */
const CLICK_ROLES = new Set(["button", "link", "checkbox", "radio", "tab", "menuitem", "option"]);

// ---------------------------------------------------------------------------
// Cancellation (SPEC 4.5: KEY_DOWN cancels the current operation)
// ---------------------------------------------------------------------------

let runId = 0;
let inFlight: AbortController | null = null;

/** Abort the running command: model request, pending actions, confirmation. */
export function cancelPipeline(): void {
  runId++;
  inFlight?.abort();
  inFlight = null;
}

// ---------------------------------------------------------------------------
// Tab + content-script messaging
// ---------------------------------------------------------------------------

export { rememberTab };

async function sendToContent<T>(
  tabId: number,
  type: string,
  payload: unknown,
  timeoutMs: number
): Promise<T | null> {
  const message: Envelope = {
    ns: ENVELOPE_NS,
    target: "content",
    type,
    reqId: crypto.randomUUID(),
    payload,
  };
  try {
    const response = (await Promise.race([
      chrome.tabs.sendMessage(tabId, message),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`content script did not answer ${type}`)), timeoutMs)
      ),
    ])) as { payload?: T; ok?: boolean } | undefined;
    if (response && typeof response === "object" && "payload" in response) {
      return (response.payload ?? null) as T | null;
    }
    return (response ?? null) as T | null;
  } catch (err) {
    console.warn("[ECHO SW] content message failed:", type, err instanceof Error ? err.message : err);
    return null;
  }
}

/** SPEC 6.5: two attempts, 500 ms each. */
async function fetchIndex(tabId: number): Promise<ElementIndex | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const index = await sendToContent<ElementIndex>(
      tabId,
      "index.get",
      { force: false },
      CONTENT_MESSAGE_TIMEOUT_MS
    );
    if (index && Array.isArray(index.entries)) return index;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Settings + speech
// ---------------------------------------------------------------------------

async function loadSettings(): Promise<Partial<Settings>> {
  try {
    const data = await chrome.storage.local.get("settings");
    return (data?.settings as Partial<Settings> | undefined) ?? {};
  } catch {
    return {};
  }
}

/** Speak and resolve when speech ends, is interrupted, or a generous cap passes. */
function speakAndWait(text: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const cap = setTimeout(resolve, MAX_SPOKEN_WAIT_MS);
    void speakFromSettings(text, () => {
      clearTimeout(cap);
      resolve();
    }).catch(() => {
      clearTimeout(cap);
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Transcript handling
// ---------------------------------------------------------------------------

/**
 * SPEC 7.7: a sequencing signal is " and ", " then ", ", ", or more than one
 * lexicon verb. Commas do not survive normalization, so they are read from the
 * raw transcript.
 */
function detectMode(raw: string, normalized: NormalizedTranscript): ResolveMode {
  if (/,\s/.test(raw) || /,$/.test(raw.trim())) return "sequence";
  if (/\b(and|then)\b/.test(normalized.cleaned)) return "sequence";
  return "single";
}

function defaultVerb(entry: ElementIndexEntry): Action["verb"] {
  return CLICK_ROLES.has(entry.role) ? "click" : "focus";
}

function nameOf(index: ElementIndex, id: string): string {
  return index.entries.find((e) => e.id === id)?.name ?? "";
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run one final transcript through the pipeline. The caller has already moved
 * the session to RESOLVING. Fire-and-forget: this never rejects.
 */
export async function runPipeline(transcript: string): Promise<void> {
  const id = ++runId;
  const controller = new AbortController();
  inFlight?.abort();
  inFlight = controller;
  const alive = (): boolean => id === runId && !controller.signal.aborted;

  try {
    await run(transcript, controller.signal, alive);
  } catch (err) {
    console.error("[ECHO SW] pipeline error:", err);
    if (alive()) {
      await failWith("Something went wrong.", alive);
    }
  } finally {
    if (inFlight === controller) inFlight = null;
  }
}

/** ERROR → speak one sentence → IDLE (SPEC 4.5, 6.19). */
async function failWith(sentence: string, alive: () => boolean): Promise<void> {
  if (!alive()) return;
  await transitionTo("ERROR");
  await speakAndWait(sentence);
  if (alive()) await transitionTo("IDLE", { clarification: null });
}

async function run(transcript: string, signal: AbortSignal, alive: () => boolean): Promise<void> {
  const settings = await loadSettings();
  const verbosity: Verbosity = settings.verbosity ?? "fast";
  const audioEnabled = settings.audioEnabled !== false;

  const raw = transcript.slice(0, TRANSCRIPT_MAX_CHARS);

  // ---- global commands (SPEC 6.18): matched before any element resolution, never
  // sent to the model, and independent of the page (a new tab or a search must
  // work on a page the content script cannot read).
  const intent = matchGlobalIntent(raw);
  if (intent) return runGlobal(intent, alive);

  const tabId = await resolveTabId();
  if (tabId === null) return failWith("I can't read this page.", alive);

  const index = await fetchIndex(tabId);
  if (!alive()) return;
  if (!index) return failWith("I can't read this page.", alive);
  if (index.entries.length === 0) {
    return failWith("I don't see anything to interact with on this page.", alive);
  }

  const session = await getSession();

  // ---- clarification reply (SPEC 7.5.2) ------------------------------------
  const pinned = session.clarification;
  if (pinned) {
    if (pinned.buildId !== index.buildId || Date.now() > pinned.expiresAt) {
      // Stale candidates are worse than a lost turn: treat the reply as a fresh command.
      await transitionTo("RESOLVING", { clarification: null });
      await sendToContent(tabId, "ui.highlight", { ids: [], durationMs: 0 }, CONTENT_MESSAGE_TIMEOUT_MS);
    } else {
      return handleClarificationReply(raw, pinned, index, tabId, verbosity, alive);
    }
  }

  const normalized = normalizeTranscript(raw);
  const mode = detectMode(raw, normalized);

  // ---- tier one (SPEC 7.2), only for single commands ------------------------
  if (mode === "single") {
    const local = resolveLocal(normalized, index);
    if (local.outcome === "CONFIDENT" && local.action) {
      return executeActions([local.action], index, tabId, verbosity, alive, audioEnabled);
    }
    if (local.outcome === "AMBIGUOUS" && local.candidates) {
      // SPEC 7.4: an AMBIGUOUS local result is clarified, not sent to the model.
      return beginClarification(local.candidates, index, tabId, alive);
    }
  }

  // ---- tier two (SPEC 7.3, 11) ----------------------------------------------
  if (!alive()) return;
  await transitionTo("MODEL_RESOLVING");

  const stopTicks = startProcessingTicks(tabId, audioEnabled);
  let result: Awaited<ReturnType<typeof resolveWithGemini>>;
  try {
    result = await resolveWithGemini(
      {
        transcript: normalized.cleaned.slice(0, TRANSCRIPT_MAX_CHARS),
        index: toPromptElements(index.entries),
        pageTitle: index.title,
        mode,
      },
      index.entries,
      {
        apiKey: settings.geminiApiKey ?? null,
        model: settings.geminiModel,
        signal,
      }
    );
  } finally {
    // Tones and speech never overlap (SPEC 9.1): stop before anything is spoken.
    stopTicks();
  }
  if (!alive()) return;

  switch (result.outcome) {
    case "CONFIDENT":
      return executeActions(result.actions, index, tabId, verbosity, alive, audioEnabled);

    case "AMBIGUOUS": {
      const candidates = (result.ambiguousWith ?? [])
        .map((id) => index.entries.find((e) => e.id === id))
        .filter((e): e is ElementIndexEntry => e !== undefined && e.enabled && !e.isPassword);
      if (candidates.length >= 2 && candidates.length <= 4) {
        return beginClarification(candidates, index, tabId, alive, result.clarifyingQuestion);
      }
      return failWith(result.spokenMessage ?? "I'm not sure which one you mean.", alive);
    }

    case "MISS":
    case "ERROR":
    default:
      // The spoken sentence is friendly by design; the real cause goes to the log (SPEC 6.19).
      console.warn("[ECHO SW] model tier did not resolve:", result.outcome, result.error ?? "");
      return failWith(
        result.spokenMessage ?? formatConfirmation({ kind: "low_confidence" }, verbosity),
        alive
      );
  }
}

// ---------------------------------------------------------------------------
// Global commands (SPEC 6.18, F-15)
// ---------------------------------------------------------------------------

/**
 * EXECUTING → run the browser-level command → CONFIRMING → speak → IDLE, or
 * ERROR → speak the failure → IDLE. Same shape as a page action, so the
 * interruption and highlight-clearing rules apply unchanged.
 */
async function runGlobal(intent: GlobalIntent, alive: () => boolean): Promise<void> {
  if (!alive()) return;

  // A pending clarification is abandoned by an explicit browser command; its
  // candidate highlights live in the tab the question was asked in, which the
  // command may be about to leave.
  if ((await getSession()).clarification) {
    const tabId = await resolveTabId();
    if (tabId !== null) {
      await sendToContent(tabId, "ui.highlight", { ids: [], durationMs: 0 }, CONTENT_MESSAGE_TIMEOUT_MS);
    }
  }

  await transitionTo("EXECUTING", { clarification: null });
  const result = await runGlobalIntent(intent);
  if (!alive()) return;
  if (!result.ok) return failWith(result.sentence, alive);

  await transitionTo("CONFIRMING");
  await speakAndWait(result.sentence);
  if (alive() && (await getSession()).state === "CONFIRMING") {
    await transitionTo("IDLE", { clarification: null });
  }
}

// ---------------------------------------------------------------------------
// "Still working" ticks
// ---------------------------------------------------------------------------

/**
 * While the model is being asked (up to ~2.5 s of silence otherwise), have the
 * content script click softly every so often so the pause does not sound like a
 * frozen system. Nothing plays for a fast answer, and the returned stop function
 * must run before anything is spoken (SPEC 9.1). Failures are ignored: a tick
 * that cannot play must never affect the command.
 */
function startProcessingTicks(tabId: number, enabled: boolean): () => void {
  if (!enabled) return () => {};
  let stopped = false;
  let sent = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = (): void => {
    if (stopped || sent >= PROCESSING_TICK_MAX) return;
    sent++;
    void sendToContent(tabId, "audio.play", { kind: "processing" }, CONTENT_MESSAGE_TIMEOUT_MS);
    timer = setTimeout(tick, PROCESSING_TICK_INTERVAL_MS);
  };
  timer = setTimeout(tick, PROCESSING_TICK_FIRST_MS);

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}

// ---------------------------------------------------------------------------
// Execution (SPEC 7.6)
// ---------------------------------------------------------------------------

async function executeActions(
  actions: Action[],
  index: ElementIndex,
  tabId: number,
  verbosity: Verbosity,
  alive: () => boolean,
  audioEnabled = true
): Promise<void> {
  const request: ExecuteRequest = {
    buildId: index.buildId,
    actions,
    stepDelayMs: actions.length > 1 ? SEQUENCE_STEP_DELAY_MS : 0,
    // One positional tick per step of a sequence (SPEC 7.6.3 step 5, T1-05). A
    // single action has no progress to convey; its confirmation is enough.
    playTicks: audioEnabled && actions.length > 1,
  };

  // SPEC 7.6.1: one invalid action rejects the whole batch.
  const verdict = validateExecuteRequest(request, index);
  if (!verdict.valid) {
    console.warn("[ECHO SW] batch rejected:", verdict.reason);
    return failWith(VALIDATION_REFUSAL_PHRASE, alive);
  }

  if (!alive()) return;
  await transitionTo("EXECUTING", { clarification: null });
  await sendToContent(tabId, "ui.highlight", { ids: [], durationMs: 0 }, CONTENT_MESSAGE_TIMEOUT_MS);

  const result = await sendToContent<ExecuteResult>(tabId, "exec.run", request, EXEC_TIMEOUT_MS);
  if (!alive()) return;
  if (!result) return failWith("I can't read this page.", alive);

  // SPEC 12.10: a stale buildId is re-resolved once against a fresh index, then abandoned.
  if (!result.ok && result.results[0]?.status === "rejected") {
    return failWith(VALIDATION_REFUSAL_PHRASE, alive);
  }

  const sentence = formatConfirmation(situationFor(result, actions, index), verbosity);

  if (!result.ok) {
    // ACTION_FAILED → ERROR → speak the partial-failure sentence → IDLE (SPEC 4.5, 6.12).
    return failWith(sentence, alive);
  }

  await transitionTo("CONFIRMING");
  await speakAndWait(sentence);
  // TTS_DONE → IDLE, unless the user talked over it and KEY_DOWN already moved us on.
  if (alive() && (await getSession()).state === "CONFIRMING") {
    await transitionTo("IDLE", { clarification: null });
  }
}

function situationFor(
  result: ExecuteResult,
  actions: Action[],
  index: ElementIndex
): ConfirmationSituation {
  const stepName = (i: number): string =>
    result.results[i]?.resolvedName || nameOf(index, actions[i]?.elementId ?? "");

  if (!result.ok) {
    const failedAt = result.failedAtIndex ?? Math.max(0, result.results.length - 1);
    if (result.completed === 0 && actions.length === 1) {
      return { kind: "partial_failure", nameOfLastOk: null, name: stepName(failedAt) };
    }
    return {
      kind: "partial_failure",
      nameOfLastOk: failedAt > 0 ? stepName(failedAt - 1) : null,
      name: stepName(failedAt),
    };
  }

  if (actions.length === 1) {
    const action = actions[0];
    if (action.verb === "fill") {
      return { kind: "fill", name: stepName(0), value: action.value ?? "" };
    }
    return { kind: "click", name: stepName(0) };
  }

  return {
    kind: "sequence",
    n: result.completed,
    steps: actions.map((a, i) => ({ verb: a.verb, name: stepName(i) })),
  };
}

// ---------------------------------------------------------------------------
// Clarification (SPEC 7.5)
// ---------------------------------------------------------------------------

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

async function beginClarification(
  candidates: ElementIndexEntry[],
  index: ElementIndex,
  tabId: number,
  alive: () => boolean,
  modelQuestion?: string
): Promise<void> {
  if (!alive()) return;
  const ordered = inDocumentOrder(candidates);

  // The model's question is used only if it is short enough (SPEC 5.5: nine words).
  const question =
    modelQuestion && wordCount(modelQuestion) <= 9 && modelQuestion.length <= CLARIFY_QUESTION_MAX_CHARS
      ? modelQuestion
      : formatClarifyingQuestion(ordered);

  const now = Date.now();
  const clarification: ClarificationState = {
    question,
    candidateIds: ordered.map((c) => c.id),
    buildId: index.buildId,
    createdAt: now,
    expiresAt: now + CLARIFY_TIMEOUT_MS,
  };

  await transitionTo("CLARIFYING", { clarification });

  // SPEC 7.5.1: highlight every candidate at once while the question is asked.
  await sendToContent(
    tabId,
    "ui.highlight",
    { ids: clarification.candidateIds, durationMs: 0 },
    CONTENT_MESSAGE_TIMEOUT_MS
  );
  void speakFromSettings(question);
}

async function handleClarificationReply(
  raw: string,
  pinned: ClarificationState,
  index: ElementIndex,
  tabId: number,
  verbosity: Verbosity,
  alive: () => boolean
): Promise<void> {
  const candidates = pinned.candidateIds
    .map((id) => index.entries.find((e) => e.id === id))
    .filter((e): e is ElementIndexEntry => e !== undefined);

  const reply = resolveClarificationReply(raw, candidates);
  if (reply.kind === "resolved" && reply.entry.enabled) {
    return executeActions(
      [{ verb: defaultVerb(reply.entry), elementId: reply.entry.id }],
      index,
      tabId,
      verbosity,
      alive
    );
  }

  // SPEC 7.5.2 step 5: unresolved -> ask once more with "Say " prefixed to the
  // first option, and never a third time.
  if (pinned.question.startsWith("Say ")) {
    await transitionTo("IDLE", { clarification: null });
    void speakFromSettings("I'm not sure which one you mean.");
    return;
  }
  const retry = `Say ${pinned.question.charAt(0).toLowerCase()}${pinned.question.slice(1)}`;
  const now = Date.now();
  await transitionTo("CLARIFYING", {
    clarification: { ...pinned, question: retry, createdAt: now, expiresAt: now + CLARIFY_TIMEOUT_MS },
  });
  void speakFromSettings(retry);
}

// ---------------------------------------------------------------------------
// Highlights are cleared on every transition to IDLE (SPEC 16 F-09)
// ---------------------------------------------------------------------------

onTransition((from, to) => {
  if (to !== "IDLE" || from === "IDLE") return;
  void (async () => {
    const tabId = await resolveTabId();
    if (tabId !== null) {
      await sendToContent(tabId, "ui.highlight", { ids: [], durationMs: 0 }, CONTENT_MESSAGE_TIMEOUT_MS);
    }
  })();
});
