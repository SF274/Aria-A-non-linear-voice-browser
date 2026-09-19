/**
 * Session state machine — SPEC §4.5, §6.1, §6.4
 *
 * Owns the ECHO session lifecycle. Persisted to chrome.storage.session under
 * key SESSION_STORAGE_KEY so state survives service-worker restarts (§4.1).
 *
 * State diagram (abbreviated):
 *   IDLE → LISTENING → TRANSCRIBING → RESOLVING → … → IDLE
 *   LISTENING → ERROR (on stt.error, except no-speech/aborted)
 *   TRANSCRIBING → ERROR (on 3000 ms timeout with no result)
 *   Any → LISTENING (on KEY_DOWN in non-IDLE/CLARIFYING, cancels current op)
 *
 * Timers (owned here, cleared on every transition):
 *   - 15 s watchdog: started on KEY_DOWN, clears on KEY_UP or any exit.
 *   - 3 s transcribing timeout: started on TRANSCRIBING entry.
 *   - 15 s clarification timeout: started on CLARIFYING entry.
 */

import { SESSION_STORAGE_KEY, WATCHDOG_TIMEOUT_MS, TRANSCRIBING_TIMEOUT_MS, CLARIFY_TIMEOUT_MS } from "../shared/constants";
import type { ClarificationState } from "../shared/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionState =
  | "IDLE"
  | "LISTENING"
  | "TRANSCRIBING"
  | "RESOLVING"
  | "MODEL_RESOLVING"
  | "CLARIFYING"
  | "EXECUTING"
  | "CONFIRMING"
  | "ERROR";

export interface Session {
  state: SessionState;
  /** Last interim transcript accumulated during TRANSCRIBING (SPEC §6.4). */
  lastInterim: string | null;
  /** Final transcript, set when isFinal=true arrives. */
  finalTranscript: string | null;
  /** Present when state === "CLARIFYING". */
  clarification: ClarificationState | null;
  /** Timestamp (Date.now()) of most recent KEY_DOWN, used for 250 ms tap guard. */
  keyDownAt: number | null;
}

type TransitionCallback = (from: SessionState, to: SessionState, session: Session) => void;

// ---------------------------------------------------------------------------
// In-memory timer handles (not persisted — timers are re-armed on SW restart
// if needed, but the state persisted to session storage is authoritative).
// ---------------------------------------------------------------------------

let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
let transcribingTimer: ReturnType<typeof setTimeout> | null = null;
let clarifyTimer: ReturnType<typeof setTimeout> | null = null;

/** Registered callback for timer expiry side-effects. */
let onWatchdogFired: (() => void) | null = null;
let onTranscribingTimeout: (() => void) | null = null;
let onClarifyTimeout: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Default session
// ---------------------------------------------------------------------------

function defaultSession(): Session {
  return {
    state: "IDLE",
    lastInterim: null,
    finalTranscript: null,
    clarification: null,
    keyDownAt: null,
  };
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function loadSession(): Promise<Session> {
  try {
    const result = await chrome.storage.session.get(SESSION_STORAGE_KEY);
    const stored = result[SESSION_STORAGE_KEY] as Session | undefined;
    if (stored && typeof stored.state === "string") {
      return stored;
    }
  } catch {
    // storage.session unavailable (test environment); fall through.
  }
  return defaultSession();
}

async function saveSession(session: Session): Promise<void> {
  try {
    await chrome.storage.session.set({ [SESSION_STORAGE_KEY]: session });
  } catch {
    // test environment; ignore
  }
}

// ---------------------------------------------------------------------------
// Timer management
// ---------------------------------------------------------------------------

function clearAllTimers(): void {
  if (watchdogTimer !== null) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
  if (transcribingTimer !== null) {
    clearTimeout(transcribingTimer);
    transcribingTimer = null;
  }
  if (clarifyTimer !== null) {
    clearTimeout(clarifyTimer);
    clarifyTimer = null;
  }
}

function armWatchdog(): void {
  if (watchdogTimer !== null) clearTimeout(watchdogTimer);
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null;
    onWatchdogFired?.();
  }, WATCHDOG_TIMEOUT_MS);
}

function armTranscribingTimer(): void {
  if (transcribingTimer !== null) clearTimeout(transcribingTimer);
  transcribingTimer = setTimeout(() => {
    transcribingTimer = null;
    onTranscribingTimeout?.();
  }, TRANSCRIBING_TIMEOUT_MS);
}

function armClarifyTimer(): void {
  if (clarifyTimer !== null) clearTimeout(clarifyTimer);
  clarifyTimer = setTimeout(() => {
    clarifyTimer = null;
    onClarifyTimeout?.();
  }, CLARIFY_TIMEOUT_MS);
}

// ---------------------------------------------------------------------------
// Transition callbacks list
// ---------------------------------------------------------------------------

const transitionCallbacks: TransitionCallback[] = [];

export function onTransition(cb: TransitionCallback): void {
  transitionCallbacks.push(cb);
}

// ---------------------------------------------------------------------------
// Core transition function
// ---------------------------------------------------------------------------

/**
 * Transition the session to a new state.
 *
 * SPEC §4.5 interrupt rule: KEY_DOWN in any state except IDLE or CLARIFYING
 * cancels the current operation and moves directly to LISTENING. Callers
 * encode this by passing `force: true` from the KEY_DOWN handler.
 *
 * @param toState  The target state.
 * @param updates  Optional partial updates to merge into the session.
 * @param force    True when KEY_DOWN is interrupting (bypasses guard).
 */
export function transitionTo(
  toState: SessionState,
  updates: Partial<Omit<Session, "state">> = {},
  force = false
): Promise<Session> {
  // Transitions are read-modify-write on storage. Serialize them so a
  // pipeline step and a KEY_DOWN cannot interleave and lose an update.
  const run = transitionQueue.then(() => applyTransition(toState, updates, force));
  transitionQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

let transitionQueue: Promise<void> = Promise.resolve();

async function applyTransition(
  toState: SessionState,
  updates: Partial<Omit<Session, "state">>,
  force: boolean
): Promise<Session> {
  const session = await loadSession();
  const from = session.state;

  // SPEC §4.5: KEY_DOWN while not IDLE/CLARIFYING is always honoured.
  // The caller is responsible for passing force=true; we just clear timers.
  if (force) {
    clearAllTimers();
  }

  const next: Session = {
    ...session,
    ...updates,
    state: toState,
  };

  // A pinned clarification never outlives the session returning to IDLE.
  if (toState === "IDLE" && !("clarification" in updates)) {
    next.clarification = null;
  }

  // Per-state side-effects on entry.
  clearAllTimers();

  if (toState === "LISTENING") {
    armWatchdog();
  } else if (toState === "TRANSCRIBING") {
    armTranscribingTimer();
  } else if (toState === "CLARIFYING") {
    armClarifyTimer();
  } else if (toState === "IDLE" || toState === "ERROR") {
    // No timers needed.
  }

  await saveSession(next);

  for (const cb of transitionCallbacks) {
    try {
      cb(from, toState, next);
    } catch {
      // callbacks must not crash the state machine
    }
  }

  return next;
}

// ---------------------------------------------------------------------------
// Convenience readers
// ---------------------------------------------------------------------------

/** Read the current session without modifying it. */
export async function getSession(): Promise<Session> {
  return loadSession();
}

/** Update only transcript fields without a full state transition. */
export async function updateTranscript(
  interim: string | null,
  final: string | null
): Promise<void> {
  const session = await loadSession();
  await saveSession({
    ...session,
    lastInterim: interim ?? session.lastInterim,
    finalTranscript: final ?? session.finalTranscript,
  });
}

// ---------------------------------------------------------------------------
// Timer callback registration
// ---------------------------------------------------------------------------

/**
 * Register the function to call when the 15 s watchdog fires.
 * Typically: force stt.stop and send stt.stop to the offscreen document.
 */
export function setOnWatchdogFired(cb: () => void): void {
  onWatchdogFired = cb;
}

/**
 * Register the function to call when the 3 s transcribing timeout fires.
 * Typically: promote lastInterim to final, or transition to ERROR.
 */
export function setOnTranscribingTimeout(cb: () => void): void {
  onTranscribingTimeout = cb;
}

/**
 * Register the function to call when the 15 s clarification timeout fires.
 * Typically: discard ClarificationState and transition to IDLE.
 */
export function setOnClarifyTimeout(cb: () => void): void {
  onClarifyTimeout = cb;
}

/** Reset everything — used by tests and after a complete session. */
export async function resetSession(): Promise<void> {
  clearAllTimers();
  await saveSession(defaultSession());
}
