import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkSttMode,
  loadSettings,
  runGateIG01,
  runGateIG03,
  runGateIG06,
  runGateIG10,
  saveSettings,
  testGptZeroKey,
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
      <input id="use-local-tts" type="checkbox" checked>
      <input id="elevenlabs-api-key" type="password">
      <input id="ai-detection" type="checkbox" checked>
      <input id="gptzero-api-key" type="password">
      <button id="btn-test-gptzero"></button>
      <div id="gptzero-status"></div>
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
    expect(settings.useLocalTts).toBe(true);
    expect(settings.elevenLabsApiKey).toBeNull();
  });

  it("saves updated settings with dual-engine TTS fields", async () => {
    const useLocalTtsCheckbox = document.getElementById("use-local-tts") as HTMLInputElement;
    const elevenLabsKeyInput = document.getElementById("elevenlabs-api-key") as HTMLInputElement;

    useLocalTtsCheckbox.checked = false;
    elevenLabsKeyInput.value = "xi-secret-test-key-123";

    const saved = await saveSettings();
    expect(saved.useLocalTts).toBe(false);
    expect(saved.elevenLabsApiKey).toBe("xi-secret-test-key-123");

    const fromStorage = await loadSettings();
    expect(fromStorage.useLocalTts).toBe(false);
    expect(fromStorage.elevenLabsApiKey).toBe("xi-secret-test-key-123");
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

  describe("gate IG-03 is silent and reports only PASS or FAIL", () => {
    type Speak = (text: string, options?: { onEvent?: (e: { type: string; errorMessage?: string }) => void } & Record<string, unknown>) => void;
    const install = (speak: Speak) => {
      const tts = (globalThis as unknown as { chrome: { tts: { speak: Speak; stop: () => void } } }).chrome.tts;
      tts.speak = vi.fn(speak);
      tts.stop = vi.fn();
      return tts;
    };

    it("speaks all ten chunks at volume 0 and top rate, queued, and passes when every one ends", async () => {
      const tts = install((_t, o) => o?.onEvent?.({ type: "end" }));
      const block = await runGateIG03();

      const calls = (tts.speak as unknown as { mock: { calls: Array<[string, Record<string, unknown>]> } }).mock.calls;
      expect(calls).toHaveLength(10);
      for (const [, options] of calls) {
        expect(options.volume).toBe(0);
        expect(options.rate).toBe(10);
      }
      expect(calls.map(([, o]) => o.enqueue)).toEqual([false, ...Array(9).fill(true)]);
      expect(block).toContain("- **Status:** PASS");
      expect(block).toContain("all 10 chunks completed");
      expect(block).toContain("does not exercise the ~15 s network-voice cutoff");
    });

    it("does not report PASS until the last chunk has actually finished", async () => {
      vi.useFakeTimers();
      try {
        const pending: Array<() => void> = [];
        install((_t, o) => {
          pending.push(() => o?.onEvent?.({ type: "end" }));
        });
        let settled = false;
        const run = runGateIG03().then((b) => {
          settled = true;
          return b;
        });
        await vi.advanceTimersByTimeAsync(5000);
        expect(settled).toBe(false); // the old code reported PASS after 600 ms regardless
        pending.forEach((finish) => finish());
        expect(await run).toContain("- **Status:** PASS");
      } finally {
        vi.useRealTimers();
      }
    });

    it("FAILs and stops the queue when a chunk errors", async () => {
      let n = 0;
      const tts = install((_t, o) => {
        n++;
        o?.onEvent?.(n === 4 ? { type: "error", errorMessage: "voice unavailable" } : { type: "end" });
      });
      const block = await runGateIG03();
      expect(block).toContain("- **Status:** FAIL");
      expect(block).toContain("voice unavailable");
      expect(tts.stop).toHaveBeenCalled();
    });

    it("FAILs when a chunk is interrupted or cancelled", async () => {
      install((_t, o) => o?.onEvent?.({ type: "interrupted" }));
      expect(await runGateIG03()).toMatch(/Status:\*\* FAIL[\s\S]*chunk 1 was interrupted/);
    });

    it("FAILs, rather than hanging, when the engine never answers", async () => {
      vi.useFakeTimers();
      try {
        const tts = install(() => {});
        const run = runGateIG03();
        await vi.advanceTimersByTimeAsync(30_500);
        const block = await run;
        expect(block).toContain("- **Status:** FAIL");
        expect(block).toContain("only 0 of 10 chunks finished");
        expect(tts.stop).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("FAILs when chrome.tts is missing", async () => {
      (globalThis as unknown as { chrome: { tts?: unknown } }).chrome.tts = undefined;
      expect(await runGateIG03()).toContain("- **Status:** FAIL");
    });
  });

  it("gate IG-06 produces formatted copy-pasteable markdown block and blocks when no key is set", async () => {
    const block = await runGateIG06();
    expect(block).toContain("### IG-06 — Gemini model identifier valid, responseSchema honoured");
    expect(block).toContain("- **Status:** BLOCKED");
    expect(block).toContain("No geminiApiKey configured in options");
  });

  it("gate IG-06 reports Google's own error message, not just the status code", async () => {
    await chrome.storage.local.set({
      settings: {
        geminiApiKey: "k",
        geminiModel: "gemini-3.1-flash-lite",
        verbosity: "fast",
        ttsVoiceName: null,
        ttsRate: 1.6,
        holdKey: "Space",
        scanKey: "KeyM",
        telemetryEnabled: false,
        audioEnabled: true,
        useLocalTts: true,
        elevenLabsApiKey: null,
      },
    });
    const respond = (status: number, body: string) =>
      vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));
    try {
      respond(402, JSON.stringify({ error: { code: 402, message: "Billing is not enabled for this project." } }));
      let block = await runGateIG06();
      expect(block).toContain("- **Status:** FAIL");
      expect(block).toContain("API returned HTTP 402: Billing is not enabled for this project.");

      respond(503, "upstream unavailable");
      block = await runGateIG06();
      expect(block).toContain("API returned HTTP 503: upstream unavailable");

      respond(500, "");
      block = await runGateIG06();
      expect(block).toContain("API returned HTTP 500\n");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("gate IG-10 produces formatted copy-pasteable markdown block", async () => {
    const block = await runGateIG10();
    expect(block).toContain("### IG-10 — Convex write succeeds from an MV3 service worker");
    expect(block).toContain("- **Blocks:** F-18");
  });
});

// ---------------------------------------------------------------------------
// F-22 / HD-13
// ---------------------------------------------------------------------------

describe("GPTZero settings and key check (HD-13, F-22)", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="ai-detection" type="checkbox" checked>
      <input id="gptzero-api-key" type="password">
      <button id="btn-test-gptzero"></button>
      <div id="gptzero-status"></div>
      <div id="save-status"></div>
    `;
    let store: Record<string, unknown> = {};
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: vi.fn(async (k?: string) => (k ? { [k]: store[k] } : { ...store })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            store = { ...store, ...items };
          }),
        },
      },
    };
  });

  it("persists the key and the toggle", async () => {
    (document.getElementById("gptzero-api-key") as HTMLInputElement).value = "  gptzero-secret  ";
    (document.getElementById("ai-detection") as HTMLInputElement).checked = false;
    const saved = await saveSettings();
    expect(saved.gptZeroApiKey).toBe("gptzero-secret");
    expect(saved.aiDetection).toBe(false);
    expect((await loadSettings()).gptZeroApiKey).toBe("gptzero-secret");
  });

  it("stores null rather than an empty string when the field is blank", async () => {
    expect((await saveSettings()).gptZeroApiKey).toBeNull();
  });

  it("keeps detection on when the checkbox is missing from the page", async () => {
    document.getElementById("ai-detection")?.remove();
    expect((await saveSettings()).aiDetection).toBe(true);
  });

  it("says plainly that there is no key, without calling anything", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const message = await testGptZeroKey();
    expect(message).toContain("No GPTZero key");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("reports the score and the warning the user would hear", async () => {
    (document.getElementById("gptzero-api-key") as HTMLInputElement).value = "k";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ documents: [{ class_probabilities: { ai: 0.94 }, document_classification: "AI_ONLY" }] }),
        { status: 200 }
      )
    );
    const message = await testGptZeroKey();
    expect(message).toContain("94%");
    expect(message).toContain("AI_ONLY");
    expect(message).toContain("Heads up");
    vi.restoreAllMocks();
  });

  it("reports a rejected key without throwing", async () => {
    (document.getElementById("gptzero-api-key") as HTMLInputElement).value = "bad";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no", { status: 403 }));
    const message = await testGptZeroKey();
    expect(message).toContain("rejected");
    expect(message).toContain("nothing else breaks");
    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// The shipped options.html, read from disk: layout facts the DOM fixtures above
// cannot catch, because they build their own markup.
// ---------------------------------------------------------------------------

describe("options.html layout", () => {
  const html = readFileSync(
    resolve(import.meta.dirname, "..", "..", "src", "pages", "options.html"),
    "utf-8"
  );

  /**
   * Every settings input has to come before the one Save button.
   *
   * This is a regression test for a real bug: the Content Authenticity section
   * was added below the Save button, which lived inside the Gemini section. The
   * GPTZero key looked as though it had been saved, because "Test key on a
   * sample" reads the input directly and worked, but Save was above the field
   * and nothing was ever written to storage.
   */
  it("puts every settings input above the Save button", () => {
    const save = html.indexOf('id="btn-save"');
    expect(save).toBeGreaterThan(-1);
    for (const id of [
      "gemini-api-key",
      "gemini-model",
      "verbosity",
      "use-local-tts",
      "spatial-links",
      "mutation-audio",
      "elevenlabs-api-key",
      "ai-detection",
      "gptzero-api-key",
    ]) {
      const at = html.indexOf(`id="${id}"`);
      expect(at, `#${id} is missing from options.html`).toBeGreaterThan(-1);
      expect(at, `#${id} appears after the Save button, so it cannot be saved`).toBeLessThan(save);
    }
  });

  it("has exactly one Save button", () => {
    expect(html.match(/id="btn-save"/g)).toHaveLength(1);
  });

  it("uses no em dashes in anything it displays", () => {
    // The gate-diagnostics log is generated in options.ts and deliberately keeps
    // the INTEGRATION_GATES.md heading format; this covers the page's own copy.
    expect(html).not.toContain("—");
    expect(html).not.toContain("&mdash;");
  });
});
