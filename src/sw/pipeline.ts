/**
 * Command pipeline — SPEC 4.5, 6.4–6.12, 7.4–7.7, 11.4.
 *
 *   transcript → normalize → page index → tier one (local) → tier two (Gemini)
 *              → confidence gate → validation → exec.run → spoken confirmation
 *
 * Two things branch off before the element resolver: browser-level commands (SPEC
 * 6.18) and questions about the page (SPEC 11.6, 11.7), which are answered by a
 * separate plain-text call that can only ever be spoken (SPEC 8.5).
 *
 * Owned by the service worker (SPEC 4.6: "Choosing the target element" and
 * "Transcript interpretation" never belong to the content script or the
 * model). Every path ends in a spoken sentence and a return to IDLE, or in
 * CLARIFYING; none hangs (SPEC 6.19).
 */

import {
  CLARIFY_TIMEOUT_MS,
  NAVIGATION_WAIT_MS,
  PAGE_TEXT_QA_MAX_CHARS,
  PAGE_TEXT_SUMMARY_MAX_CHARS,
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
  type Verb,
  type Verbosity,
} from "../shared/contracts";
import { normalizeTranscript, type NormalizedTranscript } from "../shared/normalize";
import { rememberTab, resolveTabId } from "./active-tab";
import { type AskRequest, isShortQuestion, matchAsk } from "./commands/ask";
import { matchGlobalIntent, matchTab, runGlobalIntent, scoreTab, type GlobalIntent } from "./commands/browser";
import { answerFromContext } from "./commands/local-answers";
import { VALIDATION_REFUSAL_PHRASE, validateExecuteRequest } from "./execute/validate";
import { gatherBrowserContext } from "./gemini/context";
import { detectSynthetic, warningSentenceFor } from "./gptzero/detect";
import { answerAboutPage } from "./gemini/qa";
import { resolveWithGemini } from "./gemini/resolver";
import { toPromptElements } from "./gemini/prompts";
import {
  formatClarifyingQuestion,
  inDocumentOrder,
  resolveClarificationReply,
  verbForClarifiedTarget,
} from "./resolver/clarify";
import { resolveLocal } from "./resolver/local";
import { getSession, onTransition, transitionTo } from "./session";
import { speakFromSettings, formatConfirmation, type ConfirmationSituation } from "./tts";

const CONTENT_MESSAGE_TIMEOUT_MS = 500;
const EXEC_TIMEOUT_MS = 15_000;
const MAX_SPOKEN_WAIT_MS = 30_000;
const PAGE_TEXT_TIMEOUT_MS = 3000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** What one run needs to speak, answer and stop when the user interrupts. */
interface RunEnv {
  settings: Partial<Settings>;
  verbosity: Verbosity;
  audioEnabled: boolean;
  signal: AbortSignal;
  alive: () => boolean;
}

/** "Click the first link and tell me ...": the question waits for the clarified action. */
let clarifyFollowUp: AskRequest | null = null;

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
    console.warn("[Aria SW] content message failed:", type, err instanceof Error ? err.message : err);
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

/**
 * Speak and resolve when speech ends, is interrupted, or a generous cap passes.
 *
 * `atX` is HD-12's "spatial links": the document-relative x of whatever the
 * sentence is about, so the voice arrives from where the thing is. Omitted for
 * every sentence that is about the page as a whole rather than one element.
 */
function speakAndWait(text: string, atX?: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const cap = setTimeout(resolve, MAX_SPOKEN_WAIT_MS);
    void speakFromSettings(
      text,
      () => {
        clearTimeout(cap);
        resolve();
      },
      atX
    ).catch(() => {
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

function nameOf(index: ElementIndex, id: string): string {
  return index.entries.find((e) => e.id === id)?.name ?? "";
}

/**
 * HD-12: the document-relative x of the element an action targeted, or
 * undefined when there is no such element. `undefined`, not 0 — 0 is the far
 * left of the page, and a missing position must read as "centre", not "hard
 * left".
 */
function xOfAction(index: ElementIndex, id: string | undefined): number | undefined {
  if (!id) return undefined;
  return index.entries.find((e) => e.id === id)?.x;
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
    console.error("[Aria SW] pipeline error:", err);
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
  const env: RunEnv = { settings, verbosity, audioEnabled, signal, alive };

  const raw = transcript.slice(0, TRANSCRIPT_MAX_CHARS);

  // ---- global commands (SPEC 6.18): matched before any element resolution, never
  // sent to the model, and independent of the page (a new tab or a search must
  // work on a page the content script cannot read).
  const intent = await keepIfTabExists(matchGlobalIntent(raw));
  if (intent) return runGlobal(intent, alive);

  const session = await getSession();
  const pending = session.clarification;
  const clarifying = pending !== null && Date.now() <= pending.expiresAt;

  // ---- questions about the page (SPEC 11.6, 11.7) --------------------------------
  // A summary, the date or the tabs never need the element index. "Click X and tell
  // me ..." runs the action first and answers about what it led to. While a
  // clarification is open, other questions are treated as the reply.
  let command = raw;
  let followUp: AskRequest | null = null;
  let questionOnly: AskRequest | null = null;
  const route = matchAsk(raw);
  if (route && route.action === null) {
    if (route.ask.kind === "summary" || route.ask.contextOnly) return runAnswer(route.ask, env);
    if (!clarifying) questionOnly = route.ask;
  } else if (route && route.action !== null && !clarifying) {
    const actionIntent = await keepIfTabExists(matchGlobalIntent(route.action));
    if (actionIntent === null) {
      command = route.action;
      followUp = route.ask;
    } else if (actionIntent.kind === "switch_tab" || actionIntent.kind === "cycle_tab") {
      return runGlobal(actionIntent, alive, { ask: route.ask, env });
    }
    // Any other browser command ("search for ... and tell me ...") stays one whole command.
  }

  const tabId = await resolveTabId();
  if (tabId === null) {
    if (questionOnly) return runAnswer(questionOnly, env);
    return failWith("I can't read this page.", alive);
  }

  const index = await fetchIndex(tabId);
  if (!alive()) return;
  if (!index || index.entries.length === 0) {
    // A question needs the page's text, not its buttons.
    if (questionOnly) return runAnswer(questionOnly, env);
    return failWith(
      index ? "I don't see anything to interact with on this page." : "I can't read this page.",
      alive
    );
  }

  // ---- clarification reply (SPEC 7.5.2) ------------------------------------
  if (pending) {
    if (pending.buildId !== index.buildId || Date.now() > pending.expiresAt) {
      // Stale candidates are worse than a lost turn: treat the reply as a fresh command.
      clarifyFollowUp = null;
      await transitionTo("RESOLVING", { clarification: null });
      await sendToContent(tabId, "ui.highlight", { ids: [], durationMs: 0 }, CONTENT_MESSAGE_TIMEOUT_MS);
    } else {
      return handleClarificationReply(raw, pending, index, tabId, env);
    }
  }

  const normalized = normalizeTranscript(command);
  const mode = detectMode(command, normalized);

  // ---- tier one (SPEC 7.2), only for single commands ------------------------
  // A question is offered to the local resolver only when it is short enough to be
  // an element's name ("what's new"). "Where is the submit button" must be answered,
  // not clicked: a wrong action is worse than a wrong answer (SPEC 7.4; DEV-008).
  const tryLocal = mode === "single" && (questionOnly === null || isShortQuestion(questionOnly.question));
  if (tryLocal) {
    const local = resolveLocal(normalized, index);
    if (local.outcome === "CONFIDENT" && local.action) {
      return executeActions([local.action], index, tabId, env, followUp);
    }
    if (questionOnly === null && local.outcome === "AMBIGUOUS" && local.candidates) {
      // SPEC 7.4: an AMBIGUOUS local result is clarified, not sent to the model.
      return beginClarification(
        local.candidates,
        index,
        tabId,
        alive,
        undefined,
        followUp,
        normalized.verb
      );
    }
  }

  // A question that no element answers goes to the page-text call, never the resolver.
  if (questionOnly) return runAnswer(questionOnly, env);

  // ---- tier two (SPEC 7.3, 11) ----------------------------------------------
  if (!alive()) return;
  await transitionTo("MODEL_RESOLVING");
  // Date, time and the page's title travel in their own prompt part. No address and no
  // tab list: a click does not need to know what else is open (SPEC 8.3).
  const context = await gatherBrowserContext(tabId, { scope: "resolver" });
  if (!alive()) return;

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
        context,
      }
    );
  } finally {
    // Tones and speech never overlap (SPEC 9.1): stop before anything is spoken.
    stopTicks();
  }
  if (!alive()) return;

  switch (result.outcome) {
    case "CONFIDENT":
      return executeActions(result.actions, index, tabId, env, followUp);

    case "AMBIGUOUS": {
      const candidates = (result.ambiguousWith ?? [])
        .map((id) => index.entries.find((e) => e.id === id))
        .filter((e): e is ElementIndexEntry => e !== undefined && e.enabled && !e.isPassword);
      if (candidates.length >= 2 && candidates.length <= 4) {
        return beginClarification(
          candidates,
          index,
          tabId,
          alive,
          result.clarifyingQuestion,
          followUp,
          normalized.verb
        );
      }
      return failWith(result.spokenMessage ?? "I'm not sure which one you mean.", alive);
    }

    case "MISS":
    case "ERROR":
    default:
      // The spoken sentence is friendly by design; the real cause goes to the log (SPEC 6.19).
      console.warn("[Aria SW] model tier did not resolve:", result.outcome, result.error ?? "");
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
async function runGlobal(
  intent: GlobalIntent,
  alive: () => boolean,
  followUp?: { ask: AskRequest; env: RunEnv }
): Promise<void> {
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

  // "Switch to the airport tab and summarize it": say where we went, then answer about it.
  if (followUp) return runAnswer(followUp.ask, followUp.env, { prefix: result.sentence });

  await transitionTo("CONFIRMING");
  await speakAndWait(result.sentence);
  if (alive() && (await getSession()).state === "CONFIRMING") {
    await transitionTo("IDLE", { clarification: null });
  }
}

/**
 * "Switch to Wikipedia" has no "tab" in it, so it is a tab switch only when an open
 * tab (other than the one the user is on) really matches. Otherwise it is a page
 * command, e.g. a "Switch to grid view" button.
 */
async function keepIfTabExists(intent: GlobalIntent | null): Promise<GlobalIntent | null> {
  if (!intent || intent.kind !== "switch_tab" || !intent.soft) return intent;
  try {
    const [tabs, currentId] = await Promise.all([chrome.tabs.query({}), resolveTabId()]);
    return matchTab(intent.query, tabs.filter((t) => t.id !== currentId)) ? intent : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Answering questions (SPEC 11.6, 11.7, F-13, F-14)
// ---------------------------------------------------------------------------

interface AnswerOptions {
  /** Spoken first, e.g. "Switching to Airport." or "Clicking Home.". */
  prefix?: string;
  /** The tab the user is in; defaults to the remembered one. */
  tabId?: number;
  /** Title of the page the user just left, when a click brought them here. */
  justNavigatedFrom?: string;
}

/** The tab a question names ("the airport page"), else the one the user is on. Same window only. */
async function pickTab(query: string, currentId: number): Promise<number> {
  try {
    const { windowId } = await chrome.tabs.get(currentId);
    const tabs = await chrome.tabs.query({ windowId });
    const found = matchTab(query, tabs);
    if (!found || typeof found.tab.id !== "number") return currentId;
    // The page the user is already on wins a near tie: "the search page" is probably this one.
    const current = tabs.find((t) => t.id === currentId);
    if (current && scoreTab(query, current) >= found.score - 0.05) return currentId;
    return found.tab.id;
  } catch {
    return currentId;
  }
}

async function fetchPageText(tabId: number, maxChars: number): Promise<{ text: string } | null> {
  // A tab that just finished loading may not have its content script yet: one retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    // HD-14: paragraph breaks are kept so the classifier can score sections.
    // The answer prompt is unaffected — it re-sanitizes and collapses anyway.
    const page = await sendToContent<{ text?: unknown }>(
      tabId,
      "page.text",
      { maxChars, preserveParagraphs: true },
      PAGE_TEXT_TIMEOUT_MS
    );
    if (page && typeof page.text === "string") return { text: page.text };
    if (attempt === 0) await sleep(300);
  }
  return null;
}

/**
 * MODEL_RESOLVING → CONFIRMING → speak → IDLE. The date, the time and the open tabs are
 * answered here without a network call. Everything else is one plain-text Gemini call
 * whose reply is only ever spoken (SPEC 8.5).
 */
async function runAnswer(ask: AskRequest, env: RunEnv, opts: AnswerOptions = {}): Promise<void> {
  const { alive, settings, verbosity, audioEnabled, signal } = env;
  if (!alive()) return;
  const say = (sentence: string): string => (opts.prefix ? `${opts.prefix} ${sentence}` : sentence);

  const frontId = opts.tabId ?? (await resolveTabId());
  if (frontId === null) return failWith(say("I can't read this page."), alive);

  // A pending clarification is abandoned by a question; its highlights live in this tab.
  if ((await getSession()).clarification) {
    await sendToContent(frontId, "ui.highlight", { ids: [], durationMs: 0 }, CONTENT_MESSAGE_TIMEOUT_MS);
  }
  clarifyFollowUp = null;
  await transitionTo("MODEL_RESOLVING", { clarification: null });

  // ---- answered locally: the date, the time, the tabs -----------------------------
  if (ask.contextOnly) {
    const context = await gatherBrowserContext(frontId);
    if (!alive()) return;
    return speakAnswer(say(answerFromContext(ask.question, context)), alive);
  }

  const targetId = ask.tabQuery ? await pickTab(ask.tabQuery, frontId) : frontId;

  const page = await fetchPageText(
    targetId,
    ask.kind === "summary" ? PAGE_TEXT_SUMMARY_MAX_CHARS : PAGE_TEXT_QA_MAX_CHARS
  );
  if (!alive()) return;
  if (!page) return failWith(say("I can't read this page."), alive);
  if (!page.text.trim()) return failWith(say("This page has no text I can read."), alive);

  // F-22 (HD-13): start the synthetic-text check now so it runs underneath the
  // context gather rather than after it. It resolves to null on any failure and
  // never rejects, so nothing below has to handle it going wrong.
  const detection = detectSynthetic(page.text, {
    apiKey: settings.gptZeroApiKey ?? null,
    enabled: settings.aiDetection !== false,
    signal,
  });

  const context = await gatherBrowserContext(targetId, { justNavigatedFrom: opts.justNavigatedFrom });
  if (!alive()) return;

  const stopTicks = startProcessingTicks(frontId, audioEnabled);
  let answer: Awaited<ReturnType<typeof answerAboutPage>>;
  let warning: string | null;
  try {
    // Already settled in the common case: it has been running since before the
    // context gather. `detectSynthetic` never rejects, so this cannot throw.
    // Worst case it adds GPTZERO_TIMEOUT_MS minus the gather, and the processing
    // ticks above are already playing through it, so the wait is never silent.
    const authenticity = await detection;
    warning = warningSentenceFor(authenticity);
    answer = await answerAboutPage(
      { kind: ask.kind, question: ask.question, pageText: page.text, context, verbosity, authenticity },
      { apiKey: settings.geminiApiKey ?? null, model: settings.geminiModel, signal }
    );
  } finally {
    // Tones and speech never overlap (SPEC 9.1).
    stopTicks();
  }
  if (!alive()) return;

  if (!answer.ok) {
    console.warn("[Aria SW] page answer failed:", answer.error ?? "");
    // The warning still goes out. A page the extension could not summarize is
    // not a page the user should be told less about.
    return failWith(say(join(warning, answer.text)), alive);
  }
  return speakAnswer(say(join(warning, answer.text)), alive);
}

/** The warning first, then the answer. Spoken in that order for a reason: it is
 * the one thing the user needs before they start trusting what follows. */
function join(warning: string | null, sentence: string): string {
  return warning ? `${warning} ${sentence}` : sentence;
}

async function speakAnswer(sentence: string, alive: () => boolean): Promise<void> {
  await transitionTo("CONFIRMING");
  await speakAndWait(sentence);
  if (alive() && (await getSession()).state === "CONFIRMING") {
    await transitionTo("IDLE", { clarification: null });
  }
}

// ---------------------------------------------------------------------------
// After a click: did it navigate, and where did the user land?
// ---------------------------------------------------------------------------

interface TabSnapshot {
  url: string | undefined;
  title: string | undefined;
  windowId: number | undefined;
  tabIds: number[];
}

async function snapshotTab(tabId: number): Promise<TabSnapshot> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const siblings = await chrome.tabs.query({ windowId: tab.windowId });
    return {
      url: tab.url,
      title: tab.title,
      windowId: tab.windowId,
      tabIds: siblings.map((t) => t.id).filter((id): id is number => typeof id === "number"),
    };
  } catch {
    return { url: undefined, title: undefined, windowId: undefined, tabIds: [] };
  }
}

/**
 * A click on a link can tear the page down before the content script's reply is
 * delivered, so a missing reply is not a failure if the tab is on its way elsewhere.
 */
async function navigatedAway(tabId: number, beforeUrl: string | undefined): Promise<boolean> {
  for (let i = 0; i < 8; i++) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "loading" || tab.pendingUrl || (beforeUrl && tab.url && tab.url !== beforeUrl)) {
        return true;
      }
    } catch {
      return false;
    }
    await sleep(100);
  }
  return false;
}

/**
 * Wait for the page a click led to. The click may load a new page in this tab, open
 * a new tab, or change nothing visible (an in-page toggle); the last is detected by
 * nothing happening for a moment and answers about the page as it is.
 */
async function settleAfterAction(
  tabId: number,
  before: TabSnapshot
): Promise<{ tabId: number; navigated: boolean }> {
  const startedAt = Date.now();
  let target = tabId;
  let navigated = false;

  while (Date.now() - startedAt < NAVIGATION_WAIT_MS) {
    try {
      if (typeof before.windowId === "number") {
        const siblings = await chrome.tabs.query({ windowId: before.windowId });
        const opened = siblings.find((t) => typeof t.id === "number" && !before.tabIds.includes(t.id));
        if (opened && typeof opened.id === "number") {
          target = opened.id;
          navigated = true;
        }
      }
      const tab = await chrome.tabs.get(target);
      const moved = target !== tabId || tab.status === "loading" || (before.url && tab.url !== before.url);
      if (moved) navigated = true;
      if (navigated && tab.status === "complete" && (tab.url || tab.pendingUrl)) break;
    } catch {
      break;
    }
    if (!navigated && Date.now() - startedAt > 1200) break;
    await sleep(150);
  }

  if (navigated) await sleep(300); // let the new page's content script start (document_idle)
  if (target !== tabId) await rememberTab(target);
  return { tabId: target, navigated };
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
  env: RunEnv,
  followUp: AskRequest | null = null
): Promise<void> {
  const { verbosity, alive, audioEnabled } = env;
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
    console.warn("[Aria SW] batch rejected:", verdict.reason);
    return failWith(VALIDATION_REFUSAL_PHRASE, alive);
  }

  if (!alive()) return;
  await transitionTo("EXECUTING", { clarification: null });
  await sendToContent(tabId, "ui.highlight", { ids: [], durationMs: 0 }, CONTENT_MESSAGE_TIMEOUT_MS);

  const before = await snapshotTab(tabId);
  let result = await sendToContent<ExecuteResult>(tabId, "exec.run", request, EXEC_TIMEOUT_MS);
  if (!alive()) return;
  if (!result && (await navigatedAway(tabId, before.url))) {
    // The click worked and the page is leaving: the reply went down with it.
    result = {
      ok: true,
      completed: actions.length,
      failedAtIndex: null,
      results: actions.map((a, i) => ({
        index: i,
        verb: a.verb,
        elementId: a.elementId,
        resolvedName: nameOf(index, a.elementId) || null,
        status: "ok" as const,
      })),
    };
  }
  if (!alive()) return;
  if (!result) return failWith("I can't read this page.", alive);

  // SPEC 12.10: a stale buildId is re-resolved once against a fresh index, then abandoned.
  if (!result.ok && result.results[0]?.status === "rejected") {
    return failWith(VALIDATION_REFUSAL_PHRASE, alive);
  }

  const sentence = formatConfirmation(situationFor(result, actions, index), verbosity);
  // HD-12: the confirmation is about a specific control, and the index knows
  // where that control is. Speak it from there. For a sequence, the last step
  // is where the user's attention ended up.
  const spokenAboutX = xOfAction(index, actions[actions.length - 1]?.elementId);

  if (!result.ok) {
    // ACTION_FAILED → ERROR → speak the partial-failure sentence → IDLE (SPEC 4.5, 6.12).
    return failWith(sentence, alive);
  }

  // "Click the first link and tell me where it leads": confirm the click in the same
  // breath as the answer, about the page it actually led to.
  if (followUp) {
    const landed = await settleAfterAction(tabId, before);
    if (!alive()) return;
    return runAnswer(followUp, env, {
      prefix: sentence,
      tabId: landed.tabId,
      justNavigatedFrom: landed.navigated ? before.title : undefined,
    });
  }

  await transitionTo("CONFIRMING");
  await speakAndWait(sentence, spokenAboutX);
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
  modelQuestion?: string,
  followUp: AskRequest | null = null,
  spokenVerb: Verb | null = null
): Promise<void> {
  if (!alive()) return;
  clarifyFollowUp = followUp;
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
    // HD-14: pin the verb, not just the candidates. See ClarificationState.
    ...(spokenVerb !== null ? { verb: spokenVerb } : {}),
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
  env: RunEnv
): Promise<void> {
  const candidates = pinned.candidateIds
    .map((id) => index.entries.find((e) => e.id === id))
    .filter((e): e is ElementIndexEntry => e !== undefined);

  const reply = resolveClarificationReply(raw, candidates);
  if (reply.kind === "resolved" && reply.entry.enabled) {
    const followUp = clarifyFollowUp;
    clarifyFollowUp = null;
    // HD-14: the verb the command named survives the question. Without it,
    // "uncheck one of these" becomes a click on whichever box was named, and a
    // click toggles -- so an already-unchecked box would come back on.
    return executeActions(
      [{ verb: verbForClarifiedTarget(reply.entry, pinned.verb), elementId: reply.entry.id }],
      index,
      tabId,
      env,
      followUp
    );
  }

  // SPEC 7.5.2 step 5: unresolved -> ask once more with "Say " prefixed to the
  // first option, and never a third time.
  if (pinned.question.startsWith("Say ")) {
    clarifyFollowUp = null;
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
  clarifyFollowUp = null;
  void (async () => {
    const tabId = await resolveTabId();
    if (tabId !== null) {
      await sendToContent(tabId, "ui.highlight", { ids: [], durationMs: 0 }, CONTENT_MESSAGE_TIMEOUT_MS);
    }
  })();
});
