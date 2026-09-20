import { beforeEach, describe, expect, it, vi } from "vitest";

import validSingleFixture from "../fixtures/gemini/valid-single.json";
import validSequenceFixture from "../fixtures/gemini/valid-sequence.json";
import lowConfidenceFixture from "../fixtures/gemini/low-confidence.json";
import invalidElementIdFixture from "../fixtures/gemini/invalid-element-id.json";
import extraPropertyFixture from "../fixtures/gemini/extra-property.json";
import malformedFixture from "../fixtures/gemini/malformed.json";
import http401Fixture from "../fixtures/gemini/http-401.json";
import http429Fixture from "../fixtures/gemini/http-429.json";
import delayedFixture from "../fixtures/gemini/delayed.json";

import {
  type ElementIndexEntry,
  type ResolveRequest,
} from "../../src/shared/contracts";
import {
  toPromptElements,
} from "../../src/sw/gemini/prompts";
import {
  GeminiClientError,
  callGenerateContent,
  isModelTierDisabledForSession,
  resetModelTierSession,
} from "../../src/sw/gemini/client";
import { resolveWithGemini, toggleIntentOf } from "../../src/sw/gemini/resolver";

function createMockIndexEntries(): ElementIndexEntry[] {
  const controls = [
    { id: "el_0", role: "link", name: "Home" },
    { id: "el_11", role: "button", name: "Select 6:15 AM flight" },
    { id: "el_12", role: "button", name: "Select 9:40 AM flight" },
    { id: "el_16", role: "textbox", name: "Passenger name", value: "" },
    { id: "el_17", role: "textbox", name: "Email address", value: "" },
    { id: "el_21", role: "checkbox", name: "I accept the fare rules" },
    { id: "el_22", role: "button", name: "Confirm booking" },
    { id: "el_23", role: "button", name: "Download" },
    { id: "el_24", role: "button", name: "Download" },
    { id: "el_25", role: "button", name: "Disabled button", enabled: false },
    { id: "el_26", role: "textbox", name: "Password", isPassword: true, inputType: "password" },
  ];

  return controls.map((c, idx) => ({
    id: c.id,
    role: c.role,
    name: c.name,
    nameKey: c.name.toLowerCase(),
    x: 0.5,
    y: 0.1 + idx * 0.05,
    enabled: c.enabled ?? true,
    visible: true,
    inViewport: true,
    value: c.value ?? null,
    tag: c.role === "link" ? "a" : c.role === "textbox" ? "input" : "button",
    inputType: c.inputType ?? (c.role === "textbox" ? "text" : null),
    isPassword: c.isPassword ?? false,
  }));
}

describe("Gemini Resolver & Client (F-06 / T0-13, SPEC §11, §8, §17.4)", () => {
  const TEST_API_KEY = "test-gemini-api-key-xyz";
  let entries: ElementIndexEntry[];

  beforeEach(() => {
    resetModelTierSession();
    entries = createMockIndexEntries();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // HTTP Client and Error Behaviors (SPEC §11.4)
  // =========================================================================
  describe("Gemini Client Error Behaviors", () => {
    it("HTTP 401/403 disables the model tier for the session (SPEC §11.4 rule 1)", async () => {
      const mockFetch: typeof fetch = vi.fn(async () => {
        return new Response(JSON.stringify(http401Fixture), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      });

      expect(isModelTierDisabledForSession()).toBe(false);

      await expect(
        callGenerateContent({ test: "body" }, {
          apiKey: TEST_API_KEY,
          fetchFn: mockFetch,
        })
      ).rejects.toThrow(GeminiClientError);

      expect(isModelTierDisabledForSession()).toBe(true);

      // Subsequent call should be blocked immediately without network request
      let secondCallAttempted = false;
      const secondMockFetch: typeof fetch = vi.fn(async () => {
        secondCallAttempted = true;
        return new Response("{}", { status: 200 });
      });

      await expect(
        callGenerateContent({ test: "body" }, {
          apiKey: TEST_API_KEY,
          fetchFn: secondMockFetch,
        })
      ).rejects.toThrow(/disabled for the session/);

      expect(secondCallAttempted).toBe(false);
    });

    it("HTTP 429 rate limit produces specific error and does not retry (SPEC §11.4 rule 1)", async () => {
      let callCount = 0;
      const mockFetch: typeof fetch = vi.fn(async () => {
        callCount++;
        return new Response(JSON.stringify(http429Fixture), {
          status: 429,
          headers: { "content-type": "application/json" },
        });
      });

      await expect(
        callGenerateContent({ test: "body" }, {
          apiKey: TEST_API_KEY,
          fetchFn: mockFetch,
        })
      ).rejects.toThrow(GeminiClientError);

      expect(callCount).toBe(1); // exactly 1 attempt, NO retry
    });

    it("HTTP 5xx retries once after delay and succeeds if retry succeeds (SPEC §11.4 rule 1)", async () => {
      let callCount = 0;
      const mockFetch: typeof fetch = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response("Internal Server Error", { status: 500 });
        }
        return new Response(JSON.stringify(validSingleFixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      const res = await callGenerateContent({ test: "body" }, {
        apiKey: TEST_API_KEY,
        fetchFn: mockFetch,
      });

      expect(callCount).toBe(2);
      expect(res).toContain("el_12");
    });

    it("HTTP 5xx fails after 1 retry if retry also fails", async () => {
      let callCount = 0;
      const mockFetch: typeof fetch = vi.fn(async () => {
        callCount++;
        return new Response("Bad Gateway", { status: 502 });
      });

      await expect(
        callGenerateContent({ test: "body" }, {
          apiKey: TEST_API_KEY,
          fetchFn: mockFetch,
        })
      ).rejects.toThrow(/server error/);

      expect(callCount).toBe(2); // Initial attempt + 1 retry
    });

    it("times out at MODEL_TIMEOUT_MS = 2500 and aborts via AbortController (SPEC §11.4 rule 2)", async () => {
      const mockFetch: typeof fetch = vi.fn(async (_, init) => {
        return new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve(
              new Response(JSON.stringify(delayedFixture), {
                status: 200,
              })
            );
          }, 3000);

          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            const abortErr = new Error("This operation was aborted");
            abortErr.name = "AbortError";
            reject(abortErr);
          });
        });
      });

      const startTime = Date.now();
      await expect(
        callGenerateContent({ test: "body" }, {
          apiKey: TEST_API_KEY,
          fetchFn: mockFetch,
          timeoutMs: 150, // Shortened for fast test execution
        })
      ).rejects.toThrow(/timed out/);

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(1000); // Aborted cleanly at timeout, did not wait for 3000 ms
    });
  });

  // =========================================================================
  // Resolver Pipeline & Acceptance Criteria (SPEC 16 F-06, SPEC 17.4 Fixtures)
  // =========================================================================
  describe("Resolver Output Validation & F-06 Acceptance Criteria", () => {
    const defaultRequest: ResolveRequest = {
      transcript: "select 9:40 flight",
      index: toPromptElements(createMockIndexEntries()),
      pageTitle: "Flight Search Demo",
      mode: "single",
    };

    /** Builds a 200 response carrying the model output the test wants. */
    function modelSaying(output: unknown): typeof fetch {
      return vi.fn(async () => {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: { parts: [{ text: JSON.stringify(output) }], role: "model" },
                finishReason: "STOP",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }) as unknown as typeof fetch;
    }

    describe("explicit toggle intent (HD-14)", () => {
      it("reads check and uncheck out of the command, and nothing else", () => {
        expect(toggleIntentOf("uncheck the nonstop filter")).toBe("uncheck");
        expect(toggleIntentOf("turn off nonstop")).toBe("uncheck");
        expect(toggleIntentOf("untick the fare rules")).toBe("uncheck");
        expect(toggleIntentOf("check the fare rules")).toBe("check");
        expect(toggleIntentOf("turn on nonstop")).toBe("check");
        expect(toggleIntentOf("click the fare rules")).toBeNull();
        expect(toggleIntentOf("confirm booking")).toBeNull();
      });

      it("a command that said uncheck is not executed as a toggling click", async () => {
        const result = await resolveWithGemini(
          { ...defaultRequest, transcript: "uncheck i accept the fare rules" },
          entries,
          {
            apiKey: TEST_API_KEY,
            // The model answers with `click`, which on a checkbox flips whatever
            // state it is in -- the state-blind bug this rewrite exists to stop.
            fetchFn: modelSaying({
              actions: [{ verb: "click", elementId: "el_21" }],
              confidence: 0.94,
            }),
          }
        );

        expect(result.outcome).toBe("CONFIDENT");
        expect(result.actions).toEqual([{ verb: "uncheck", elementId: "el_21" }]);
      });

      it("a command that said check becomes check, and the model's own check is left alone", async () => {
        const rewritten = await resolveWithGemini(
          { ...defaultRequest, transcript: "turn on i accept the fare rules" },
          entries,
          {
            apiKey: TEST_API_KEY,
            fetchFn: modelSaying({
              actions: [{ verb: "click", elementId: "el_21" }],
              confidence: 0.9,
            }),
          }
        );
        expect(rewritten.actions).toEqual([{ verb: "check", elementId: "el_21" }]);

        const untouched = await resolveWithGemini(
          { ...defaultRequest, transcript: "check i accept the fare rules" },
          entries,
          {
            apiKey: TEST_API_KEY,
            fetchFn: modelSaying({
              actions: [{ verb: "check", elementId: "el_21" }],
              confidence: 0.9,
            }),
          }
        );
        expect(untouched.actions).toEqual([{ verb: "check", elementId: "el_21" }]);
      });

      it("a bare click on a checkbox stays a click", async () => {
        const result = await resolveWithGemini(
          { ...defaultRequest, transcript: "click i accept the fare rules" },
          entries,
          {
            apiKey: TEST_API_KEY,
            fetchFn: modelSaying({
              actions: [{ verb: "click", elementId: "el_21" }],
              confidence: 0.94,
            }),
          }
        );

        expect(result.actions).toEqual([{ verb: "click", elementId: "el_21" }]);
      });

      it("the rewrite never reaches a role that cannot take the verb", async () => {
        const result = await resolveWithGemini(
          { ...defaultRequest, transcript: "check out the confirm booking button" },
          entries,
          {
            apiKey: TEST_API_KEY,
            fetchFn: modelSaying({
              actions: [{ verb: "click", elementId: "el_22" }],
              confidence: 0.94,
            }),
          }
        );

        // el_22 is a button: `check` is invalid for it (SPEC 7.6.2), so the
        // model's click stands rather than the batch being refused.
        expect(result.actions).toEqual([{ verb: "click", elementId: "el_22" }]);
      });

      it("a sequence is never rewritten: the leading verb says nothing about later steps", async () => {
        const result = await resolveWithGemini(
          {
            ...defaultRequest,
            transcript: "uncheck the fare rules and confirm booking",
            mode: "sequence",
          },
          entries,
          {
            apiKey: TEST_API_KEY,
            fetchFn: modelSaying({
              actions: [
                { verb: "click", elementId: "el_21" },
                { verb: "click", elementId: "el_22" },
              ],
              confidence: 0.9,
            }),
          }
        );

        expect(result.actions).toEqual([
          { verb: "click", elementId: "el_21" },
          { verb: "click", elementId: "el_22" },
        ]);
      });
    });

    it("valid single action produces a validated Action[] (F-06 Criterion)", async () => {
      const mockFetch: typeof fetch = vi.fn(async () => {
        return new Response(JSON.stringify(validSingleFixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      const result = await resolveWithGemini(defaultRequest, entries, {
        apiKey: TEST_API_KEY,
        fetchFn: mockFetch,
      });

      expect(result.outcome).toBe("CONFIDENT");
      expect(result.actions).toEqual([
        {
          verb: "click",
          elementId: "el_12",
        },
      ]);
      expect(result.confidence).toBe(0.95);
    });

    it("valid 5-action sequence produces validated Action[] in sequence mode", async () => {
      const seqRequest: ResolveRequest = {
        ...defaultRequest,
        transcript: "book the 9:40 flight, use my saved card, and confirm",
        mode: "sequence",
      };

      const mockFetch: typeof fetch = vi.fn(async () => {
        return new Response(JSON.stringify(validSequenceFixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      const result = await resolveWithGemini(seqRequest, entries, {
        apiKey: TEST_API_KEY,
        fetchFn: mockFetch,
      });

      expect(result.outcome).toBe("CONFIDENT");
      expect(result.actions).toHaveLength(5);
      expect(result.actions[0]).toEqual({ verb: "click", elementId: "el_12" });
      expect(result.actions[1]).toEqual({
        verb: "fill",
        elementId: "el_16",
        value: "Ada Lovelace",
      });
      expect(result.actions[4]).toEqual({ verb: "click", elementId: "el_22" });
    });

    it("mode single truncates actions to 1 (SPEC §11.4 rule 4)", async () => {
      const singleRequest: ResolveRequest = {
        ...defaultRequest,
        mode: "single",
      };

      const mockFetch: typeof fetch = vi.fn(async () => {
        // Model returned a sequence of 5 actions despite mode being single
        return new Response(JSON.stringify(validSequenceFixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await resolveWithGemini(singleRequest, entries, {
        apiKey: TEST_API_KEY,
        fetchFn: mockFetch,
      });

      expect(result.outcome).toBe("CONFIDENT");
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].elementId).toBe("el_12");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Mode is 'single': truncating actions")
      );
    });

    it("response containing extra selector/xpath property has it stripped (F-06 Criterion)", async () => {
      const mockFetch: typeof fetch = vi.fn(async () => {
        return new Response(JSON.stringify(extraPropertyFixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      const result = await resolveWithGemini(defaultRequest, entries, {
        apiKey: TEST_API_KEY,
        fetchFn: mockFetch,
      });

      expect(result.outcome).toBe("CONFIDENT");
      expect(result.actions).toHaveLength(1);
      const action = result.actions[0] as Record<string, unknown>;
      expect(action.verb).toBe("click");
      expect(action.elementId).toBe("el_12");
      expect(action.selector).toBeUndefined();
      expect(action.xpath).toBeUndefined();
    });

    it("response containing elementId 'el_999' is rejected with low-confidence spoken string (F-06 Criterion)", async () => {
      const mockFetch: typeof fetch = vi.fn(async () => {
        return new Response(JSON.stringify(invalidElementIdFixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await resolveWithGemini(defaultRequest, entries, {
        apiKey: TEST_API_KEY,
        fetchFn: mockFetch,
      });

      expect(result.outcome).toBe("MISS");
      expect(result.actions).toHaveLength(0);
      expect(result.spokenMessage).toBe("I'm not sure which one you mean.");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Element id not in index: el_999")
      );
    });

    it("low confidence with ambiguousWith triggers clarification (SPEC §7.4, §11.3)", async () => {
      const mockFetch: typeof fetch = vi.fn(async () => {
        return new Response(JSON.stringify(lowConfidenceFixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      const result = await resolveWithGemini(defaultRequest, entries, {
        apiKey: TEST_API_KEY,
        fetchFn: mockFetch,
      });

      expect(result.outcome).toBe("AMBIGUOUS");
      expect(result.confidence).toBe(0.6);
      expect(result.ambiguousWith).toEqual(["el_23", "el_24"]);
      expect(result.clarifyingQuestion).toBe("PDF or Word?");
      expect(result.spokenMessage).toBe("PDF or Word?");
    });

    it("malformed JSON body is treated as miss and logs body length without body itself (SPEC §11.4 rule 3)", async () => {
      const mockFetch: typeof fetch = vi.fn(async () => {
        return new Response(JSON.stringify(malformedFixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await resolveWithGemini(defaultRequest, entries, {
        apiKey: TEST_API_KEY,
        fetchFn: mockFetch,
      });

      expect(result.outcome).toBe("MISS");
      expect(result.spokenMessage).toBe("I'm not sure which one you mean.");

      // Assert warning was called with byte length and NOT with the raw body text
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Body parse failure. Byte length:"),
        expect.anything()
      );
      const loggedStrings = warnSpy.mock.calls.flat().join(" ");
      expect(loggedStrings).not.toContain("NOT_VALID_JSON_AT_ALL");
    });

    it("confidence outside [0, 1] is clamped and penalised by 0.1 (SPEC §11.4 rule 5)", async () => {
      const outOfRangeFixture = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    actions: [{ verb: "click", elementId: "el_12" }],
                    confidence: 1.5, // malformed > 1
                  }),
                },
              ],
            },
          },
        ],
      };

      const mockFetch: typeof fetch = vi.fn(async () => {
        return new Response(JSON.stringify(outOfRangeFixture), { status: 200 });
      });

      const result = await resolveWithGemini(defaultRequest, entries, {
        apiKey: TEST_API_KEY,
        fetchFn: mockFetch,
      });

      // Clamped to 1.0, then penalised by 0.1 -> 0.90
      expect(result.confidence).toBeCloseTo(0.9, 5);
      expect(result.outcome).toBe("CONFIDENT");
    });

    it("falls back to local candidates on rate limit if candidates exist (SPEC §11.4 rule 1)", async () => {
      const mockFetch: typeof fetch = vi.fn(async () => {
        return new Response(JSON.stringify(http429Fixture), { status: 429 });
      });

      const localCandidates = [entries[7], entries[8]]; // el_23, el_24
      const result = await resolveWithGemini(defaultRequest, entries, {
        apiKey: TEST_API_KEY,
        fetchFn: mockFetch,
        localCandidates,
      });

      expect(result.outcome).toBe("AMBIGUOUS");
      expect(result.ambiguousWith).toEqual(["el_23", "el_24"]);
      expect(result.spokenMessage).toBe("Which one did you mean?");
    });

    it("missing API key returns error and prompts user to add key in options", async () => {
      const result = await resolveWithGemini(defaultRequest, entries, {
        apiKey: null,
      });

      expect(result.outcome).toBe("ERROR");
      expect(result.spokenMessage).toBe(
        "Add your API key in the extension options."
      );
    });
  });
});
