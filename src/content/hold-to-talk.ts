/**
 * Hold-to-talk key capture — SPEC §6.1, §9.6
 *
 * Registers capture-phase keydown/keyup listeners on window. On each matching
 * event, sends key.down / key.up messages to the service worker.
 *
 * Rules (SPEC §6.1):
 *   - Listen for keydown/keyup matching settings.holdKey (default "Space").
 *   - Do NOT intercept when event.target is an editable element.
 *   - keydown: preventDefault(), resume AudioContext, play listenStart, send key.down.
 *   - keyup: play listenEnd, send key.up.
 *   - Taps under 250 ms are discarded by the SW; the content script still sends both.
 *   - 15 s watchdog and tap guard logic lives in the SW (session.ts).
 *
 * SPEC §5.16 envelope: key.down / key.up → target "sw".
 */

import { ENVELOPE_NS } from "../shared/contracts";
import type { Envelope } from "../shared/contracts";
import { resumeAudioContext, playListenStart, playListenEnd } from "./audio-stubs";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Default hold key (SPEC §5.13). Loaded from settings; falls back to "Space". */
let holdKey = "Space";

/** Accept only a non-empty string: a corrupt or partial settings object keeps the current key. */
function pickHoldKey(settings: unknown): string | null {
  if (typeof settings !== "object" || settings === null) return null;
  const key = (settings as { holdKey?: unknown }).holdKey;
  return typeof key === "string" && key.length > 0 ? key : null;
}

/**
 * Load the hold key once on init. The options page saves the whole Settings
 * object under the single `settings` key (SPEC 5.13), so the key lives at
 * `settings.holdKey`, not at a top-level `holdKey` entry.
 */
export async function loadSettings(): Promise<void> {
  try {
    const result = await chrome.storage.local.get("settings");
    const key = pickHoldKey(result?.settings);
    if (key) holdKey = key;
  } catch {
    // storage unavailable in some test contexts; use default
  }
}

/** Keep the hold key live when the options page saves new settings. */
export function handleStorageChange(
  changes: Record<string, { newValue?: unknown }>,
  areaName?: string
): void {
  if (areaName !== undefined && areaName !== "local") return;
  const key = pickHoldKey(changes.settings?.newValue);
  if (key) holdKey = key;
}

if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener(handleStorageChange);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the event target is an editable field.
 * SPEC §6.1: "Do not intercept if event.target is an editable text field."
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  const htmlEl = target as HTMLElement;
  if (htmlEl.isContentEditable) return true;
  if (htmlEl.contentEditable && htmlEl.contentEditable !== "inherit" && htmlEl.contentEditable !== "false") return true;
  const ceAttr = target.getAttribute("contenteditable");
  if (ceAttr !== null && ceAttr !== "false") return true;
  if (target.closest?.("[contenteditable]:not([contenteditable='false'])")) return true;
  return false;
}

/** Send a message to the service worker and ignore errors. */
function sendToSW(type: string, payload: unknown): void {
  const msg: Envelope = {
    ns: ENVELOPE_NS,
    target: "sw",
    type,
    reqId: crypto.randomUUID(),
    payload,
  };
  chrome.runtime.sendMessage(msg).catch((err) => {
    // SPEC §6.1 failure branch: content script cannot reach SW.
    // Try to re-inject using scripting API (handled in the SW on its end).
    console.warn("[ECHO content] sendMessage failed:", err);
  });
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function onKeyDown(event: KeyboardEvent): void {
  if (event.code !== holdKey) return;
  if (isEditableTarget(event.target)) return;
  // Prevent the browser default for the hold key (e.g. scroll on Space).
  event.preventDefault();
  // Holding a key makes the OS repeat `keydown`. Only the first one is the
  // press; a repeat must not be reported as a new KEY_DOWN, which would be
  // read as "talking over the system" and restart the capture mid-utterance.
  if (event.repeat) return;

  // SPEC §9.6 rule 2: resume AudioContext inside the keydown handler (user gesture).
  void resumeAudioContext().then(() => {
    void playListenStart();
  });

  sendToSW("key.down", { key: event.code });
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.code !== holdKey) return;
  if (isEditableTarget(event.target)) return;

  void playListenEnd();
  sendToSW("key.up", { key: event.code });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/**
 * Initialize the hold-to-talk listeners.
 * Called once from content/index.ts on page load.
 */
export function initHoldToTalk(): void {
  void loadSettings();
  // Capture phase ensures we intercept before focusable elements process Space.
  window.addEventListener("keydown", onKeyDown, { capture: true });
  window.addEventListener("keyup", onKeyUp, { capture: true });
}

/** Remove listeners (used in tests for cleanup). */
export function destroyHoldToTalk(): void {
  window.removeEventListener("keydown", onKeyDown, { capture: true });
  window.removeEventListener("keyup", onKeyUp, { capture: true });
}

/** Exposed for tests: get the currently active hold key. */
export function getHoldKey(): string {
  return holdKey;
}

/** Exposed for tests: set hold key without storage. */
export function setHoldKey(key: string): void {
  holdKey = key;
}
