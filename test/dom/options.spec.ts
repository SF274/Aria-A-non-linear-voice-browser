import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkSttMode,
  loadSettings,
  runGateIG01,
  runGateIG03,
  runGateIG06,
  runGateIG10,
  saveSettings,
} from "../../src/pages/options";

describe("Options page DOM and storage unit tests (SPEC 5.13, 8.6, 10.3, 16 F-21)", () => {
  beforeEach(() => {
    // Reset jsdom document
    document.body.innerHTML = `
      <input id="gemini-api-key" type="password">
      <input id="gemini-model" type="text" value="gemini-3.1-flash-lite">
      <select id="verbosity">
        <option value="fast" selected>Fast</option>
        <option value="verbose">Verbose</option>
      </select>
      <button id="btn-save">Save Settings</button>
      <div id="save-status"></div>
      <div id="stt-mode-display"></div>
      <button id="btn-install-model"></button>
      <div id="stt-install-status"></div>
      <pre id="gate-results-log"></pre>
    `;

    // Mock chrome.storage.local
    let store: Record<string, unknown> = {};
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: vi.fn(async (keys?: string | string[] | null) => {
            if (!keys) return { ...store };
            if (typeof keys === "string") return { [keys]: store[keys] };
            const res: Record<string, unknown> = {};
            for (const k of keys) res[k] = store[k];
            return res;
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            store = { ...store, ...items };
          }),
          clear: vi.fn(async () => {
            store = {};
          }),
        },
      },
      tts: {
        speak: vi.fn((_text: string, options?: { onEvent?: (e: { type: string }) => void }) => {
          options?.onEvent?.({ type: "end" });
        }),
      },
    };
  });

  it("loads default settings when storage is empty", async () => {
    const settings = await loadSettings();
    expect(settings.geminiApiKey).toBeNull();
    expect(settings.geminiModel).toBe("gemini-3.1-flash-lite");
    expect(settings.verbosity).toBe("fast");
    expect(settings.ttsRate).toBe(1.6);
  });

  it("saves updated settings with verbosity=fast giving ttsRate=1.6", async () => {
    const keyInput = document.getElementById("gemini-api-key") as HTMLInputElement;
    const modelInput = document.getElementById("gemini-model") as HTMLInputElement;
    const verbositySelect = document.getElementById("verbosity") as HTMLSelectElement;

    keyInput.value = "AIzaSySecretTestKey";
    modelInput.value = "gemini-custom";
    verbositySelect.value = "fast";

    const saved = await saveSettings();
    expect(saved.geminiApiKey).toBe("AIzaSySecretTestKey");
    expect(saved.geminiModel).toBe("gemini-custom");
    expect(saved.verbosity).toBe("fast");
    expect(saved.ttsRate).toBe(1.6);

    const statusEl = document.getElementById("save-status");
    expect(statusEl?.textContent).toContain("Settings saved successfully.");

    // Verify storage was called
    const fromStorage = await loadSettings();
    expect(fromStorage.geminiApiKey).toBe("AIzaSySecretTestKey");
  });

  it("saves updated settings with verbosity=verbose giving ttsRate=1.0", async () => {
    const verbositySelect = document.getElementById("verbosity") as HTMLSelectElement;
    verbositySelect.value = "verbose";

    const saved = await saveSettings();
    expect(saved.verbosity).toBe("verbose");
    expect(saved.ttsRate).toBe(1.0);
  });

  it("reports cloud when SpeechRecognition.available is absent", async () => {
    const mode = await checkSttMode();
    expect(mode).toContain("cloud");
  });

  it("gate IG-01 produces formatted copy-pasteable markdown block", async () => {
    const block = await runGateIG01();
    expect(block).toContain("### IG-01 — On-device STT available");
    expect(block).toContain("- **Status:**");
    expect(block).toContain("- **Date:**");
    expect(block).toContain("- **Blocks:** F-03 offline claim");
  });

  it("gate IG-03 produces formatted copy-pasteable markdown block using chrome.tts", async () => {
    const block = await runGateIG03();
    expect(block).toContain("### IG-03 — chrome.tts speaks a chunked 60 s passage to completion");
    expect(block).toContain("- **Status:** PASS");
    expect(block).toContain("- **Blocks:** F-08");
  });

  it("gate IG-06 produces formatted copy-pasteable markdown block and blocks when no key is set", async () => {
    const block = await runGateIG06();
    expect(block).toContain("### IG-06 — Gemini model identifier valid, responseSchema honoured");
    expect(block).toContain("- **Status:** BLOCKED");
    expect(block).toContain("No geminiApiKey configured in options");
  });

  it("gate IG-10 produces formatted copy-pasteable markdown block", async () => {
    const block = await runGateIG10();
    expect(block).toContain("### IG-10 — Convex write succeeds from an MV3 service worker");
    expect(block).toContain("- **Blocks:** F-18");
  });
});
