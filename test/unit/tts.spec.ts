import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chunkTextIntoSentences,
  formatConfirmation,
  selectTtsVoice,
  situationFromResult,
  speakFromSettings,
  speakText,
  stopTts,
} from "../../src/sw/tts";
import type { ExecuteResult } from "../../src/shared/contracts";
import {
  CONFIRMATION_NAME_MAX_CHARS,
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_VOICE_ID,
} from "../../src/shared/constants";

describe("TTS service unit tests (SPEC §10.6, HD-A06, HD-07)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    // Mock chrome APIs
    const mockTts = {
      speak: vi.fn(),
      stop: vi.fn(),
    };

    const mockTabs = {
      query: vi.fn(async () => [{ id: 42, active: true }]),
      sendMessage: vi.fn(async () => ({ ok: true })),
    };

    const mockStorage = {
      local: {
        get: vi.fn(async () => ({
          settings: {
            useLocalTts: true,
            elevenLabsApiKey: null,
            ttsVoiceName: "Alex",
            ttsRate: 1.6,
          },
        })),
      },
    };

    (globalThis as unknown as { chrome: unknown }).chrome = {
      tts: mockTts,
      tabs: mockTabs,
      storage: mockStorage,
    };
  });

  // -------------------------------------------------------------------------
  // 1. Voice selection priority (SPEC §10.6.2)
  // -------------------------------------------------------------------------
  describe("selectTtsVoice (SPEC §10.6.2)", () => {
    it("returns null if voice list is empty", () => {
      expect(selectTtsVoice([])).toBeNull();
    });

    it("prioritizes non-Google English voice over Google English voice", () => {
      const voices: chrome.tts.TtsVoice[] = [
        { voiceName: "Google US English", lang: "en-US" },
        { voiceName: "Samantha", lang: "en-US" },
        { voiceName: "Google UK English", lang: "en-GB" },
      ];
      expect(selectTtsVoice(voices)).toBe("Samantha");
    });

    it("falls back to Google English voice if no non-Google English voice exists", () => {
      const voices: chrome.tts.TtsVoice[] = [
        { voiceName: "Google US English", lang: "en-US" },
        { voiceName: "Amelie", lang: "fr-FR" },
      ];
      expect(selectTtsVoice(voices)).toBe("Google US English");
    });

    it("falls back to first available voice if no English voice exists", () => {
      const voices: chrome.tts.TtsVoice[] = [
        { voiceName: "Amelie", lang: "fr-FR" },
        { voiceName: "Anna", lang: "de-DE" },
      ];
      expect(selectTtsVoice(voices)).toBe("Amelie");
    });
  });

  // -------------------------------------------------------------------------
  // 2. Sentence chunking (SPEC §10.6.2)
  // -------------------------------------------------------------------------
  describe("chunkTextIntoSentences (SPEC §10.6.2)", () => {
    it("does not split text <= 200 characters", () => {
      const short = "This is a short confirmation message.";
      expect(chunkTextIntoSentences(short)).toEqual([short]);
    });

    it("splits text > 200 characters at sentence boundaries", () => {
      const sentence1 = "First sentence of the long utterance that provides details.";
      const sentence2 = "Second sentence goes here and continues to provide context.";
      const sentence3 = "Third sentence finishes the utterance with final instructions and clarity.";
      const sentence4 = "Fourth sentence ensures we exceed the 200 character boundary comfortably.";
      const fullText = `${sentence1} ${sentence2} ${sentence3} ${sentence4}`;
      expect(fullText.length).toBeGreaterThan(200);

      const chunks = chunkTextIntoSentences(fullText);
      expect(chunks.length).toBe(4);
      expect(chunks[0]).toBe(sentence1);
      expect(chunks[1]).toBe(sentence2);
      expect(chunks[2]).toBe(sentence3);
      expect(chunks[3]).toBe(sentence4);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Confirmation templates & 40-char truncation (SPEC §10.6.3)
  // -------------------------------------------------------------------------
  describe("formatConfirmation (SPEC §10.6.3)", () => {
    it("formats single click: fast vs verbose", () => {
      expect(formatConfirmation({ kind: "click", name: "Submit" }, "fast")).toBe("Submit.");
      expect(formatConfirmation({ kind: "click", name: "Submit" }, "verbose")).toBe(
        "Clicked Submit."
      );
    });

    it("formats single fill: fast vs verbose", () => {
      expect(
        formatConfirmation({ kind: "fill", name: "Email", value: "test@example.com" }, "fast")
      ).toBe("test@example.com in Email.");
      expect(
        formatConfirmation({ kind: "fill", name: "Email", value: "test@example.com" }, "verbose")
      ).toBe("Entered test@example.com in Email.");
    });

    it("formats sequence of n: fast vs verbose", () => {
      const seq = {
        kind: "sequence" as const,
        n: 2,
        steps: [
          { verb: "click", name: "Next" },
          { verb: "fill", name: "Username" },
        ],
      };
      expect(formatConfirmation(seq, "fast")).toBe("Done. 2 steps.");
      expect(formatConfirmation(seq, "verbose")).toBe("Done. I clicked Next, then filled Username.");
    });

    it("formats sequence with up to 3 named steps in verbose", () => {
      const seq = {
        kind: "sequence" as const,
        n: 4,
        steps: [
          { verb: "click", name: "First" },
          { verb: "fill", name: "Second" },
          { verb: "click", name: "Third" },
          { verb: "click", name: "Fourth" },
        ],
      };
      expect(formatConfirmation(seq, "fast")).toBe("Done. 4 steps.");
      expect(formatConfirmation(seq, "verbose")).toBe(
        "Done. I clicked First, then filled Second, then clicked Third."
      );
    });

    it("formats partial failure: fast vs verbose", () => {
      const pf = {
        kind: "partial_failure" as const,
        nameOfLastOk: "Step 1",
        name: "Step 2",
      };
      expect(formatConfirmation(pf, "fast")).toBe("Stopped at Step 2.");
      expect(formatConfirmation(pf, "verbose")).toBe(
        "I got as far as Step 1, then couldn't find Step 2."
      );
    });

    it("formats partial failure when no previous step succeeded", () => {
      const pf = {
        kind: "partial_failure" as const,
        nameOfLastOk: null,
        name: "Step 1",
      };
      expect(formatConfirmation(pf, "verbose")).toBe("Couldn't find Step 1.");
    });

    it("formats not found: fast vs verbose", () => {
      expect(formatConfirmation({ kind: "not_found", transcript: "checkout" }, "fast")).toBe(
        "I can't find that."
      );
      expect(formatConfirmation({ kind: "not_found", transcript: "checkout" }, "verbose")).toBe(
        "I couldn't find anything called checkout on this page."
      );
    });

    it("formats low confidence: fast vs verbose", () => {
      expect(formatConfirmation({ kind: "low_confidence" }, "fast")).toBe("Not sure which one.");
      expect(formatConfirmation({ kind: "low_confidence" }, "verbose")).toBe(
        "I'm not sure which one you mean."
      );
    });

    it("truncates names longer than 40 characters per SPEC §10.6.3", () => {
      const veryLongName = "A".repeat(60);
      const expectedName = "A".repeat(CONFIRMATION_NAME_MAX_CHARS);

      const fastClick = formatConfirmation({ kind: "click", name: veryLongName }, "fast");
      expect(fastClick).toBe(`${expectedName}.`);

      const verboseClick = formatConfirmation({ kind: "click", name: veryLongName }, "verbose");
      expect(verboseClick).toBe(`Clicked ${expectedName}.`);
    });
  });

  // -------------------------------------------------------------------------
  // 4. situationFromResult mapping
  // -------------------------------------------------------------------------
  describe("situationFromResult", () => {
    it("maps single successful click", () => {
      const res: ExecuteResult = {
        ok: true,
        completed: 1,
        failedAtIndex: null,
        results: [
          {
            index: 0,
            verb: "click",
            elementId: "el_1",
            resolvedName: "Sign In",
            status: "ok",
          },
        ],
      };
      expect(situationFromResult(res)).toEqual({ kind: "click", name: "Sign In" });
    });

    it("maps multiple successful steps to sequence", () => {
      const res: ExecuteResult = {
        ok: true,
        completed: 2,
        failedAtIndex: null,
        results: [
          { index: 0, verb: "click", elementId: "el_1", resolvedName: "Next", status: "ok" },
          { index: 1, verb: "fill", elementId: "el_2", resolvedName: "Email", status: "ok" },
        ],
      };
      expect(situationFromResult(res)).toEqual({
        kind: "sequence",
        n: 2,
        steps: [
          { verb: "click", name: "Next" },
          { verb: "fill", name: "Email" },
        ],
      });
    });

    it("maps partial failure", () => {
      const res: ExecuteResult = {
        ok: false,
        completed: 1,
        failedAtIndex: 1,
        results: [
          { index: 0, verb: "click", elementId: "el_1", resolvedName: "Step 1", status: "ok" },
          { index: 1, verb: "click", elementId: "el_2", resolvedName: "Step 2", status: "not_found" },
        ],
      };
      expect(situationFromResult(res)).toEqual({
        kind: "partial_failure",
        nameOfLastOk: "Step 1",
        name: "Step 2",
      });
    });

    it("maps not found when ok=false and no steps", () => {
      const res: ExecuteResult = {
        ok: false,
        completed: 0,
        failedAtIndex: null,
        results: [],
      };
      expect(situationFromResult(res, "search button")).toEqual({
        kind: "not_found",
        transcript: "search button",
      });
    });
  });

  // -------------------------------------------------------------------------
  // 5. Dual-engine speakText routing (HD-A06, HD-07)
  // -------------------------------------------------------------------------
  describe("speakText dual-engine routing", () => {
    it("uses chrome.tts when useLocalTts is true", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await speakText({
        text: "Testing local TTS.",
        useLocalTts: true,
        elevenLabsApiKey: "secret-key",
        ttsVoiceName: "Alex",
        ttsRate: 1.6,
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(chrome.tts.speak).toHaveBeenCalledWith(
        "Testing local TTS.",
        expect.objectContaining({ rate: 1.6, voiceName: "Alex", enqueue: false })
      );
    });

    it("falls back to chrome.tts when useLocalTts is false but apiKey is null", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await speakText({
        text: "No key fallback.",
        useLocalTts: false,
        elevenLabsApiKey: null,
        ttsVoiceName: null,
        ttsRate: 1.6,
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(chrome.tts.speak).toHaveBeenCalledWith(
        "No key fallback.",
        expect.objectContaining({ rate: 1.6, enqueue: false })
      );
    });

    it("calls ElevenLabs Flash API and sends audio to content script when useLocalTts is false", async () => {
      const fakeAudioBytes = new Uint8Array([1, 2, 3, 4]);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => fakeAudioBytes.buffer,
      } as unknown as Response);

      await speakText({
        text: "Spoken by ElevenLabs.",
        useLocalTts: false,
        elevenLabsApiKey: "xi-test-api-key-123",
        ttsVoiceName: null,
        ttsRate: 1.6,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        `https://api.elevenlabs.io/v1/text-to-speech/${DEFAULT_ELEVENLABS_VOICE_ID}`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "xi-api-key": "xi-test-api-key-123",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            text: "Spoken by ElevenLabs.",
            model_id: DEFAULT_ELEVENLABS_MODEL_ID,
            output_format: "mp3_44100_128",
          }),
        })
      );

      // Verify message sent to content script tab 42
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          type: "tts.play",
          target: "content",
        })
      );
      expect(chrome.tts.speak).not.toHaveBeenCalled();
    });

    it("falls back to chrome.tts if ElevenLabs fetch returns non-200 HTTP status", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as unknown as Response);

      await speakText({
        text: "Error fallback.",
        useLocalTts: false,
        elevenLabsApiKey: "bad-key",
        ttsVoiceName: null,
        ttsRate: 1.6,
      });

      expect(chrome.tts.speak).toHaveBeenCalledWith(
        "Error fallback.",
        expect.objectContaining({ rate: 1.6 })
      );
    });

    it("falls back to chrome.tts if ElevenLabs fetch throws an error", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));

      await speakText({
        text: "Network error fallback.",
        useLocalTts: false,
        elevenLabsApiKey: "test-key",
        ttsVoiceName: null,
        ttsRate: 1.6,
      });

      expect(chrome.tts.speak).toHaveBeenCalledWith(
        "Network error fallback.",
        expect.objectContaining({ rate: 1.6 })
      );
    });

    it("falls back to chrome.tts if no active tab exists for audio playback", async () => {
      (chrome.tabs.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await speakText({
        text: "No tab fallback.",
        useLocalTts: false,
        elevenLabsApiKey: "test-key",
        ttsVoiceName: null,
        ttsRate: 1.6,
      });

      expect(chrome.tts.speak).toHaveBeenCalledWith(
        "No tab fallback.",
        expect.objectContaining({ rate: 1.6 })
      );
    });
  });

  // -------------------------------------------------------------------------
  // 6. Interruption (SPEC §10.6.4 & §4.5)
  // -------------------------------------------------------------------------
  describe("stopTts (SPEC §10.6.4)", () => {
    it("calls chrome.tts.stop and aborts any active fetch", async () => {
      let aborted = false;
      vi.spyOn(globalThis, "fetch").mockImplementationOnce((_url, init) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise(() => {}); // never resolves
      });

      // Start ElevenLabs playback in background
      void speakText({
        text: "Will be interrupted.",
        useLocalTts: false,
        elevenLabsApiKey: "test-key",
        ttsVoiceName: null,
        ttsRate: 1.6,
      });

      // Allow microtask to start fetch
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Call stopTts()
      stopTts();

      expect(chrome.tts.stop).toHaveBeenCalled();
      expect(aborted).toBe(true);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          type: "tts.stop",
          target: "content",
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // 7. speakFromSettings convenience wrapper
  // -------------------------------------------------------------------------
  describe("speakFromSettings", () => {
    it("reads settings from storage and calls speakText", async () => {
      await speakFromSettings("Hello world");
      expect(chrome.storage.local.get).toHaveBeenCalledWith("settings");
      expect(chrome.tts.speak).toHaveBeenCalledWith(
        "Hello world",
        expect.objectContaining({ rate: 1.6, voiceName: "Alex" })
      );
    });
  });
});
