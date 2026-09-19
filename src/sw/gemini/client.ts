/**
 * Gemini API HTTP Client — SPEC §8.6, §11.3, §11.4, §17.4.
 *
 * Direct HTTP fetch client with:
 * - Injectable fetch function.
 * - API key strictly in x-goog-api-key header (never in query parameters).
 * - AbortController with 2500 ms timeout and no timeout retry.
 * - 401/403 session disabling.
 * - 429 rate limit refusal (no retry).
 * - 5xx single retry after 300 ms.
 */

import {
  DEFAULT_GEMINI_MODEL,
  MODEL_5XX_MAX_RETRIES,
  MODEL_5XX_RETRY_DELAY_MS,
  MODEL_BUSY_SPOKEN_MESSAGE,
  MODEL_TIMEOUT_MS,
} from "../../shared/constants";

export type FetchFn = typeof fetch;

export interface GeminiClientOptions {
  apiKey: string;
  model?: string;
  fetchFn?: FetchFn;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type GeminiClientErrorCode =
  | "AUTH_ERROR"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "CLIENT_ERROR"
  | "SESSION_DISABLED";

export class GeminiClientError extends Error {
  readonly code: GeminiClientErrorCode;
  readonly status?: number;
  readonly spokenMessage: string;

  constructor(
    code: GeminiClientErrorCode,
    message: string,
    spokenMessage: string,
    status?: number
  ) {
    super(message);
    this.name = "GeminiClientError";
    this.code = code;
    this.status = status;
    this.spokenMessage = spokenMessage;
  }
}

// Track session-level model tier disablement (SPEC §11.4 rule 1)
let modelTierDisabledForSession = false;

export function isModelTierDisabledForSession(): boolean {
  return modelTierDisabledForSession;
}

export function disableModelTierForSession(): void {
  modelTierDisabledForSession = true;
}

export function resetModelTierSession(): void {
  modelTierDisabledForSession = false;
}

/**
 * Executes a generateContent HTTP request against the Google Generative Language API.
 */
export async function callGenerateContent(
  body: unknown,
  options: GeminiClientOptions
): Promise<string> {
  const {
    apiKey,
    model = DEFAULT_GEMINI_MODEL,
    fetchFn = globalThis.fetch,
    timeoutMs = MODEL_TIMEOUT_MS,
  } = options;

  if (modelTierDisabledForSession) {
    throw new GeminiClientError(
      "SESSION_DISABLED",
      "Model tier is disabled for the session due to a previous authentication failure",
      "Your API key isn't working.",
      401
    );
  }

  if (!apiKey || apiKey.trim().length === 0) {
    throw new GeminiClientError(
      "AUTH_ERROR",
      "No Gemini API key provided",
      "Add your API key in the extension options."
    );
  }

  // API key strictly in headers, never in the URL query string (SPEC §8.6, §11.3)
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;

  const serializedBody = typeof body === "string" ? body : JSON.stringify(body);

  let attempt = 0;
  while (attempt <= MODEL_5XX_MAX_RETRIES) {
    const controller = new AbortController();
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    // Link caller signal if supplied
    const onCallerAbort = () => {
      controller.abort();
    };
    if (options.signal) {
      if (options.signal.aborted) {
        clearTimeout(timer);
        throw new GeminiClientError(
          "CLIENT_ERROR",
          "Request aborted by caller",
          "I couldn't reach the model."
        );
      }
      options.signal.addEventListener("abort", onCallerAbort, { once: true });
    }

    try {
      const response = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "content-type": "application/json",
        },
        body: serializedBody,
        signal: controller.signal,
      });

      clearTimeout(timer);
      if (options.signal) {
        options.signal.removeEventListener("abort", onCallerAbort);
      }

      // Handle HTTP status per SPEC §11.4
      if (response.ok) {
        return await response.text();
      }

      const status = response.status;

      // 401/403 -> Auth failure (disable model tier for session)
      if (status === 401 || status === 403) {
        disableModelTierForSession();
        throw new GeminiClientError(
          "AUTH_ERROR",
          `Gemini API returned HTTP ${status}`,
          "Your API key isn't working.",
          status
        );
      }

      // 429 -> Rate limited (no retry)
      if (status === 429) {
        throw new GeminiClientError(
          "RATE_LIMITED",
          "Gemini API rate limited (HTTP 429)",
          // Spoken aloud, so it says what to do rather than naming the API's status (DEV-007).
          MODEL_BUSY_SPOKEN_MESSAGE,
          429
        );
      }

      // 5xx -> Server error (retry once after 300 ms)
      if (status >= 500 && status < 600) {
        if (attempt < MODEL_5XX_MAX_RETRIES) {
          attempt++;
          await new Promise((r) => setTimeout(r, MODEL_5XX_RETRY_DELAY_MS));
          continue;
        }
        throw new GeminiClientError(
          "SERVER_ERROR",
          `Gemini API server error (HTTP ${status}) after retry`,
          "I couldn't reach the model.",
          status
        );
      }

      // Other non-2xx
      throw new GeminiClientError(
        "CLIENT_ERROR",
        `Gemini API returned unexpected HTTP ${status}`,
        "I couldn't reach the model.",
        status
      );
    } catch (err) {
      clearTimeout(timer);
      if (options.signal) {
        options.signal.removeEventListener("abort", onCallerAbort);
      }

      if (err instanceof GeminiClientError) {
        throw err;
      }

      if (timedOut) {
        // SPEC §11.4 rule 2: Timeout at MODEL_TIMEOUT_MS = 2500 ms: abort via AbortController. No retry.
        throw new GeminiClientError(
          "TIMEOUT",
          `Gemini API request timed out after ${timeoutMs} ms`,
          "I couldn't reach the model."
        );
      }

      // If aborted by caller
      if (options.signal?.aborted) {
        throw new GeminiClientError(
          "CLIENT_ERROR",
          "Request aborted by caller",
          "I couldn't reach the model."
        );
      }

      // Network / fetch error
      throw new GeminiClientError(
        "NETWORK_ERROR",
        err instanceof Error ? err.message : String(err),
        "I couldn't reach the model."
      );
    }
  }

  throw new GeminiClientError(
    "SERVER_ERROR",
    "Gemini API request failed after max retries",
    "I couldn't reach the model."
  );
}
