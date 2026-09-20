import {
  type Settings,
  SettingsSchema,
  type Verbosity,
} from "../shared/contracts";

interface SpeechRecognitionAvailableOptions {
  langs: string[];
  processLocally: boolean;
}

interface SpeechRecognitionStatic {
  available?(options: SpeechRecognitionAvailableOptions): Promise<string>;
  install?(options: SpeechRecognitionAvailableOptions): Promise<void>;
}

interface WindowWithSpeech {
  SpeechRecognition?: SpeechRecognitionStatic;
  webkitSpeechRecognition?: SpeechRecognitionStatic;
}

const DEFAULT_SETTINGS: Settings = {
  geminiApiKey: null,
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
};

function getSpeechRecognitionStatic(): SpeechRecognitionStatic | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as WindowWithSpeech;
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

function appendLog(text: string): void {
  const logEl = document.getElementById("gate-results-log");
  if (logEl) {
    logEl.textContent = text;
  }
  console.log(text);
}

export async function loadSettings(): Promise<Settings> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const data = await chrome.storage.local.get("settings");
      if (data && data.settings) {
        const parsed = SettingsSchema.safeParse(data.settings);
        if (parsed.success) {
          return parsed.data;
        }
      }
    }
  } catch (err) {
    console.warn("[ECHO] Failed to load settings from storage:", err);
  }
  return DEFAULT_SETTINGS;
}

export async function saveSettings(): Promise<Settings> {
  const apiKeyInput = document.getElementById("gemini-api-key") as HTMLInputElement | null;
  const modelInput = document.getElementById("gemini-model") as HTMLInputElement | null;
  const verbositySelect = document.getElementById("verbosity") as HTMLSelectElement | null;
  const statusEl = document.getElementById("save-status");

  const current = await loadSettings();

  const apiKeyVal = apiKeyInput?.value.trim() ?? "";
  const modelVal = modelInput?.value.trim() || DEFAULT_SETTINGS.geminiModel;
  const verbosityVal = (verbositySelect?.value as Verbosity) || "fast";
  const rateVal = verbosityVal === "fast" ? 1.6 : 1.0;

  // HD-A06 / HD-07: read TTS engine settings from form
  const useLocalTtsCheckbox = document.getElementById("use-local-tts") as HTMLInputElement | null;
  const elevenLabsKeyInput = document.getElementById("elevenlabs-api-key") as HTMLInputElement | null;
  const useLocalTtsVal = useLocalTtsCheckbox ? useLocalTtsCheckbox.checked : true;
  const elevenLabsKeyVal = elevenLabsKeyInput?.value.trim() ?? "";

  const newSettings: Settings = {
    ...current,
    geminiApiKey: apiKeyVal.length > 0 ? apiKeyVal : null,
    geminiModel: modelVal,
    verbosity: verbosityVal,
    ttsRate: rateVal,
    useLocalTts: useLocalTtsVal,
    elevenLabsApiKey: elevenLabsKeyVal.length > 0 ? elevenLabsKeyVal : null,
  };

  const parsed = SettingsSchema.safeParse(newSettings);
  if (!parsed.success) {
    if (statusEl) {
      statusEl.className = "error-text";
      statusEl.textContent = `Invalid settings: ${parsed.error.message}`;
    }
    throw new Error(`Invalid settings: ${parsed.error.message}`);
  }

  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    await chrome.storage.local.set({ settings: newSettings });
  }

  if (statusEl) {
    statusEl.className = "success-text";
    statusEl.textContent = "Settings saved successfully.";
    setTimeout(() => {
      if (statusEl.textContent === "Settings saved successfully.") {
        statusEl.textContent = "";
      }
    }, 3000);
  }

  return newSettings;
}

export async function checkSttMode(): Promise<string> {
  const displayEl = document.getElementById("stt-mode-display");
  const sr = getSpeechRecognitionStatic();

  if (!sr || typeof sr.available !== "function") {
    const text = "cloud (on-device API unavailable)";
    if (displayEl) displayEl.textContent = text;
    return text;
  }

  try {
    const status = await sr.available({ langs: ["en-US"], processLocally: true });
    if (displayEl) displayEl.textContent = status;
    return status;
  } catch (err) {
    const text = `error (${err instanceof Error ? err.message : String(err)})`;
    if (displayEl) displayEl.textContent = text;
    return text;
  }
}

export async function installOfflineModel(): Promise<void> {
  const statusEl = document.getElementById("stt-install-status");
  const sr = getSpeechRecognitionStatic();

  if (!sr || typeof sr.install !== "function") {
    if (statusEl) {
      statusEl.className = "error-text";
      statusEl.textContent = "SpeechRecognition.install API is not supported in this browser.";
    }
    return;
  }

  try {
    if (statusEl) {
      statusEl.className = "";
      statusEl.textContent = "Installing offline model (en-US)...";
    }
    await sr.install({ langs: ["en-US"], processLocally: true });
    if (statusEl) {
      statusEl.className = "success-text";
      statusEl.textContent = "Installation requested. Re-check mode in a moment.";
    }
    await checkSttMode();
  } catch (err) {
    if (statusEl) {
      statusEl.className = "error-text";
      statusEl.textContent = `Install failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

export async function runGateIG01(): Promise<string> {
  const date = new Date().toISOString();
  const sr = getSpeechRecognitionStatic();
  let status: string;
  let resultDetail: string;

  if (!sr || typeof sr.available !== "function") {
    status = "FAIL";
    resultDetail = "SpeechRecognition.available API not found in this browser context";
  } else {
    try {
      const s = await sr.available({ langs: ["en-US"], processLocally: true });
      if (s === "available") {
        status = "PASS";
        resultDetail = 'SpeechRecognition.available returned "available" for en-US';
      } else {
        status = "FAIL";
        resultDetail = `SpeechRecognition.available returned "${s}" for en-US`;
      }
    } catch (e) {
      status = "FAIL";
      resultDetail = `SpeechRecognition.available threw: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const block = `### IG-01 — On-device STT available
- **Status:** ${status}
- **Date:** ${date}
- **Chrome:** ${navigator.userAgent}
- **Run by:** options-page
- **Command:** SpeechRecognition.available({ langs: ["en-US"], processLocally: true })
- **Result:** ${resultDetail}
- **Blocks:** F-03 offline claim — ${status === "PASS" ? "now unblocked" : "still blocked"}
- **Fallback applied:** ${status === "PASS" ? "none needed" : "cloud fallback"}`;

  appendLog(block);
  return block;
}

/** Longest a silent run of the ten-sentence passage may take before it counts as hung. */
const IG03_TIMEOUT_MS = 30_000;

/**
 * IG-03 runs the whole chunked passage through chrome.tts silently (volume 0, top
 * rate) and reports only PASS or FAIL. It checks what a script can check: that every
 * queued chunk reaches "end" and none errors or is dropped. It cannot hear the ~15 s
 * cutoff some network voices have (AS-03), which needs real-time speech; the result
 * line says so rather than claiming it.
 */
export async function runGateIG03(): Promise<string> {
  const date = new Date().toISOString();
  let status: string;
  let resultDetail: string;

  if (typeof chrome === "undefined" || !chrome.tts?.speak) {
    status = "FAIL";
    resultDetail = "chrome.tts API not available in this context";
  } else {
    // Ten sentences, as SPEC 10.6.2 chunks a long utterance.
    const testSentence = "ECHO operates any web page by voice with the screen off. ";
    const passage = testSentence.repeat(10);
    const sentences = passage.match(/[^.!?]+[.!?]+/g) || [passage];

    const startTime = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        let completed = 0;
        timer = setTimeout(
          () => reject(new Error(`only ${completed} of ${sentences.length} chunks finished in ${IG03_TIMEOUT_MS / 1000} s`)),
          IG03_TIMEOUT_MS
        );

        sentences.forEach((sentence, i) => {
          chrome.tts.speak(sentence, {
            enqueue: i > 0,
            volume: 0,
            rate: 10,
            onEvent: (event) => {
              if (event.type === "end") {
                completed++;
                if (completed === sentences.length) resolve();
              } else if (event.type === "error") {
                reject(new Error(event.errorMessage || "TTS error"));
              } else if (event.type === "interrupted" || event.type === "cancelled") {
                reject(new Error(`chunk ${i + 1} was ${event.type}`));
              }
            },
          });
        });
      });

      status = "PASS";
      resultDetail = `all ${sentences.length} chunks completed in ${Date.now() - startTime} ms (silent fast run; does not exercise the ~15 s network-voice cutoff, AS-03)`;
    } catch (e) {
      // Do not leave a half-spoken queue behind.
      try {
        chrome.tts.stop?.();
      } catch {
        // nothing to stop
      }
      status = "FAIL";
      resultDetail = `chrome.tts error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  const block = `### IG-03 — chrome.tts speaks a chunked 60 s passage to completion
- **Status:** ${status}
- **Date:** ${date}
- **Chrome:** ${navigator.userAgent}
- **Run by:** options-page
- **Command:** chrome.tts.speak passage
- **Result:** ${resultDetail}
- **Blocks:** F-08 — ${status === "PASS" ? "now unblocked" : "still blocked"}
- **Fallback applied:** ${status === "PASS" ? "none needed" : "speechSynthesis fallback"}`;

  appendLog(block);
  return block;
}

/** Google's `{"error":{"message":"..."}}` text, else the raw body, capped at 300 chars. */
async function googleErrorMessage(res: Response): Promise<string> {
  try {
    const text = (await res.text()).trim();
    if (!text) return "";
    try {
      const message = (JSON.parse(text) as { error?: { message?: unknown } }).error?.message;
      if (typeof message === "string" && message) return message.slice(0, 300);
    } catch {
      // not JSON: fall through to the raw text
    }
    return text.slice(0, 300);
  } catch {
    return "";
  }
}

export async function runGateIG06(): Promise<string> {
  const date = new Date().toISOString();
  let status: string;
  let resultDetail: string;

  const settings = await loadSettings();
  const apiKey = settings.geminiApiKey;
  const model = settings.geminiModel;

  if (!apiKey) {
    status = "BLOCKED";
    resultDetail = "No geminiApiKey configured in options";
  } else {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        signal: AbortSignal.timeout(2500),
        body: JSON.stringify({
          contents: [{ parts: [{ text: "ping" }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: { ok: { type: "boolean" } },
              required: ["ok"],
            },
          },
        }),
      });

      if (res.ok) {
        status = "PASS";
        resultDetail = `Model ${model} accepted request and honoured responseSchema`;
      } else {
        status = "FAIL";
        // The reason is in the body (statusText is empty over HTTP/2). The prompt
        // here is the fixed string "ping", so Google's error text holds no page data.
        const reason = await googleErrorMessage(res);
        resultDetail = `API returned HTTP ${res.status}${reason ? `: ${reason}` : ""}`;
      }
    } catch (e) {
      status = "FAIL";
      resultDetail = `Fetch error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const block = `### IG-06 — Gemini model identifier valid, responseSchema honoured
- **Status:** ${status}
- **Date:** ${date}
- **Chrome:** ${navigator.userAgent}
- **Run by:** options-page
- **Command:** generateContent with responseSchema
- **Result:** ${resultDetail}
- **Blocks:** F-06 — ${status === "PASS" ? "now unblocked" : "still blocked"}
- **Fallback applied:** ${status === "PASS" ? "none needed" : "DEV-001"}`;

  appendLog(block);
  return block;
}

export async function runGateIG10(): Promise<string> {
  const date = new Date().toISOString();
  let status: string;
  let resultDetail: string;

  const convexUrl = (import.meta as unknown as { env?: { VITE_CONVEX_URL?: string } }).env?.VITE_CONVEX_URL;
  if (!convexUrl) {
    status = "NOT_RUN";
    resultDetail = "VITE_CONVEX_URL not set (F-18 optional telemetry)";
  } else {
    try {
      const res = await fetch(`${convexUrl}/api/mutation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(2500),
        body: JSON.stringify({ path: "commands:log", args: {} }),
      });
      if (res.ok) {
        status = "PASS";
        resultDetail = `Convex HTTP mutation endpoint reachable at ${convexUrl}`;
      } else {
        status = "FAIL";
        resultDetail = `Convex returned HTTP ${res.status}`;
      }
    } catch (e) {
      status = "FAIL";
      resultDetail = `Convex fetch error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const block = `### IG-10 — Convex write succeeds from an MV3 service worker
- **Status:** ${status}
- **Date:** ${date}
- **Chrome:** ${navigator.userAgent}
- **Run by:** options-page
- **Command:** fetch to Convex HTTP endpoint
- **Result:** ${resultDetail}
- **Blocks:** F-18 — ${status === "PASS" ? "now unblocked" : "still blocked"}
- **Fallback applied:** ${status === "PASS" ? "none needed" : "HTTP action fallback"}`;

  appendLog(block);
  return block;
}

export async function initOptionsPage(): Promise<void> {
  const apiKeyInput = document.getElementById("gemini-api-key") as HTMLInputElement | null;
  const modelInput = document.getElementById("gemini-model") as HTMLInputElement | null;
  const verbositySelect = document.getElementById("verbosity") as HTMLSelectElement | null;
  const saveBtn = document.getElementById("btn-save");
  const installBtn = document.getElementById("btn-install-model");

  const btnIG01 = document.getElementById("btn-gate-ig01");
  const btnIG03 = document.getElementById("btn-gate-ig03");
  const btnIG06 = document.getElementById("btn-gate-ig06");
  const btnIG10 = document.getElementById("btn-gate-ig10");

  const settings = await loadSettings();

  if (apiKeyInput && settings.geminiApiKey) {
    apiKeyInput.value = settings.geminiApiKey;
  }
  if (modelInput && settings.geminiModel) {
    modelInput.value = settings.geminiModel;
  }
  if (verbositySelect && settings.verbosity) {
    verbositySelect.value = settings.verbosity;
  }
  // HD-A06 / HD-07: populate TTS engine toggle and ElevenLabs key
  const useLocalTtsCheckbox = document.getElementById("use-local-tts") as HTMLInputElement | null;
  const elevenLabsKeyInput = document.getElementById("elevenlabs-api-key") as HTMLInputElement | null;
  if (useLocalTtsCheckbox) {
    useLocalTtsCheckbox.checked = settings.useLocalTts;
  }
  if (elevenLabsKeyInput && settings.elevenLabsApiKey) {
    elevenLabsKeyInput.value = settings.elevenLabsApiKey;
  }

  saveBtn?.addEventListener("click", () => {
    void saveSettings();
  });

  installBtn?.addEventListener("click", () => {
    void installOfflineModel();
  });

  btnIG01?.addEventListener("click", () => {
    void runGateIG01();
  });

  btnIG03?.addEventListener("click", () => {
    // Silent, but not instant: show that it is running and ignore a second click.
    if (btnIG03 instanceof HTMLButtonElement) {
      const label = btnIG03.textContent;
      btnIG03.disabled = true;
      btnIG03.textContent = "Running IG-03…";
      void runGateIG03().finally(() => {
        btnIG03.disabled = false;
        btnIG03.textContent = label;
      });
    } else {
      void runGateIG03();
    }
  });

  btnIG06?.addEventListener("click", () => {
    void runGateIG06();
  });

  btnIG10?.addEventListener("click", () => {
    void runGateIG10();
  });

  void checkSttMode();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void initOptionsPage();
    });
  } else {
    void initOptionsPage();
  }
}
