/**
 * Permission page script — SPEC §6.2, §10.2, §4.4
 *
 * This page is opened as a real, active tab (not a popup, not an offscreen
 * document) because getUserMedia can only *prompt* for microphone permission
 * from a real tab on the extension origin.
 *
 * Flow:
 *   1. Call getUserMedia({ audio: true }).
 *   2. If granted: stop all tracks immediately (we only needed the prompt),
 *      write micGranted: true to chrome.storage.local, close the tab.
 *   3. If denied: write micGranted: false, close the tab.
 *      The service worker reads the value after the tab closes and speaks
 *      the "I need microphone access" sentence.
 */

const statusEl = document.getElementById("status");

function setStatus(text: string, cls: "ok" | "err"): void {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = cls;
}

async function requestPermission(): Promise<void> {
  let stream: MediaStream | undefined;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Stop all tracks immediately — we do not need the audio; we only needed
    // the prompt so that the extension origin holds the granted permission.
    stream.getTracks().forEach((t) => t.stop());

    await chrome.storage.local.set({ micGranted: true });
    setStatus("✓ Microphone granted. This tab will close shortly.", "ok");
  } catch {
    // getUserMedia rejected (user denied, hardware missing, etc.).
    await chrome.storage.local.set({ micGranted: false });
    setStatus("✗ Microphone access was denied.", "err");
  } finally {
    // Always stop any remaining tracks, even on partial errors.
    if (stream) {
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore
      }
    }
    // Give the user a moment to read the status before the tab closes.
    setTimeout(() => {
      window.close();
    }, 800);
  }
}

// Start immediately — the page has no user interaction to trigger autoplay
// policy concerns since we are not playing audio.
void requestPermission();
