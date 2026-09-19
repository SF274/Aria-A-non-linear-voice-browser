/**
 * Microphone permission and offscreen document guard — SPEC §6.2, §10.2, §4.3
 *
 * Two responsibilities:
 *   1. ensureMicPermission()  — opens permission.html if not yet granted.
 *   2. ensureOffscreen()      — idempotent guard for the offscreen document.
 *
 * SPEC §10.2 exact flow:
 *   if micGranted === true  → return true immediately
 *   open permission.html as active tab
 *   await tab close
 *   re-read micGranted
 *   return micGranted === true
 *
 * Failure branch (SPEC §6.2):
 *   - User denies → write false, speak the error sentence, return false.
 *   - getUserMedia inside offscreen throws NotAllowedError → reset micGranted,
 *     retry the full flow once. If it fails again, log to state/ERRORS.md and
 *     return false.
 */

import { MIC_GRANTED_KEY } from "../shared/constants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read micGranted from chrome.storage.local. Returns false if absent. */
async function readMicGranted(): Promise<boolean> {
  const result = await chrome.storage.local.get(MIC_GRANTED_KEY);
  return result[MIC_GRANTED_KEY] === true;
}

/** Wait until the given tab is closed (chrome.tabs.onRemoved). */
function waitForTabClose(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const listener = (closedId: number) => {
      if (closedId === tabId) {
        chrome.tabs.onRemoved.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onRemoved.addListener(listener);
  });
}

// ---------------------------------------------------------------------------
// Mic permission
// ---------------------------------------------------------------------------

/**
 * Ensure the microphone permission is granted.
 *
 * Returns true when micGranted is (or becomes) true.
 * Returns false if the user denied or if we cannot get permission.
 *
 * SPEC §10.2 — the flow runs at most once per session; subsequent calls
 * are fast because we read from storage.
 */
export async function ensureMicPermission(): Promise<boolean> {
  if (await readMicGranted()) return true;

  // Open permission.html as a real tab — the only origin context that can
  // prompt for microphone permission in MV3 (SPEC §10.2 [FACT]).
  const permissionUrl = chrome.runtime.getURL("src/pages/permission.html");
  const tab = await chrome.tabs.create({ url: permissionUrl, active: true });

  if (typeof tab.id !== "number") {
    // Unexpected: tab creation failed.
    return false;
  }

  await waitForTabClose(tab.id);
  return readMicGranted();
}

/**
 * Reset the mic grant flag (called on NotAllowedError from the offscreen doc).
 * SPEC §6.2 last bullet: "treat this as 'grant flow never ran', reset micGranted".
 */
export async function resetMicGranted(): Promise<void> {
  await chrome.storage.local.set({ [MIC_GRANTED_KEY]: false });
}

// ---------------------------------------------------------------------------
// Offscreen document
// ---------------------------------------------------------------------------

/**
 * Ensure the offscreen document exists. Idempotent — calling it while one
 * already exists is a no-op (SPEC §4.3 [FACT]: creating while one exists
 * throws; this guard catches that case and reuses).
 */
export async function ensureOffscreen(): Promise<void> {
  // chrome.offscreen.hasDocument is available in Chrome 116+.
  // If the API is absent, skip — the offscreen document may already exist or
  // the environment doesn't support it (e.g. tests).
  if (!chrome.offscreen) return;

  let hasDoc = false;
  try {
    hasDoc = await chrome.offscreen.hasDocument();
  } catch {
    // hasDocument unavailable in older Chrome; proceed optimistically.
  }

  if (hasDoc) return;

  try {
    await chrome.offscreen.createDocument({
      url: "src/offscreen/index.html",
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "SpeechRecognition requires USER_MEDIA reason (SPEC §4.3)",
    });
  } catch (err) {
    // If creation throws because one already exists (race), ignore the error.
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes("only one offscreen")) {
      throw err;
    }
  }
}
