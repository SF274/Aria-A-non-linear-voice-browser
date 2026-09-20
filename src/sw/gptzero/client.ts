/**
 * GPTZero HTTP client — F-22, HD-13 / DEV-011.
 *
 * One call, `POST /v2/predict/text`, key in the `x-api-key` header and never in
 * the URL (SPEC 8.6, applied to the second key the same way as the first).
 *
 * The contract this module keeps with its caller is narrower than the Gemini
 * client's: **it throws for the caller to swallow, and it never retries.** The
 * detector is an advisory layer over a voice loop that has to answer either way,
 * so a failure here has exactly one correct handling — proceed without a
 * verdict. Retrying would spend the user's silence on a warning they may not
 * even need.
 */

import { GPTZERO_ENDPOINT, GPTZERO_TIMEOUT_MS } from "../../shared/constants";

export type FetchFn = typeof fetch;

export type GptZeroErrorCode = "AUTH_ERROR" | "RATE_LIMITED" | "SERVER_ERROR" | "TIMEOUT" | "NETWORK_ERROR";

export class GptZeroError extends Error {
  readonly code: GptZeroErrorCode;
  readonly status?: number;

  constructor(code: GptZeroErrorCode, message: string, status?: number) {
    super(message);
    this.name = "GptZeroError";
    this.code = code;
    this.status = status;
  }
}

/**
 * A 401/403 means the key is wrong, and it will stay wrong for the session. The
 * flag stops every later page paying a round trip to be told so again.
 */
let disabledForSession = false;

export function isGptZeroDisabledForSession(): boolean {
  return disabledForSession;
}

export function disableGptZeroForSession(): void {
  disabledForSession = true;
}

export function resetGptZeroSession(): void {
  disabledForSession = false;
}

export interface GptZeroOptions {
  apiKey: string;
  fetchFn?: FetchFn;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Raw response body of a successful classification. Parsing is `detect.ts`'s job. */
export async function classifyText(document: string, options: GptZeroOptions): Promise<string> {
  const { apiKey, fetchFn = globalThis.fetch, timeoutMs = GPTZERO_TIMEOUT_MS } = options;

  if (disabledForSession) throw new GptZeroError("AUTH_ERROR", "GPTZero disabled for this session", 401);
  if (!apiKey || apiKey.trim().length === 0) throw new GptZeroError("AUTH_ERROR", "No GPTZero API key");

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  // A key release cancels the whole utterance (SPEC 6.19); this call goes with it.
  const onCallerAbort = (): void => controller.abort();
  options.signal?.addEventListener("abort", onCallerAbort, { once: true });

  try {
    const response = await fetchFn(GPTZERO_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ document, multilingual: false }),
      signal: controller.signal,
    });

    if (response.ok) return await response.text();

    const status = response.status;
    if (status === 401 || status === 403) {
      disableGptZeroForSession();
      throw new GptZeroError("AUTH_ERROR", `GPTZero returned HTTP ${status}`, status);
    }
    if (status === 429) throw new GptZeroError("RATE_LIMITED", "GPTZero rate limited", 429);
    if (status >= 500) throw new GptZeroError("SERVER_ERROR", `GPTZero returned HTTP ${status}`, status);
    throw new GptZeroError("NETWORK_ERROR", `GPTZero returned HTTP ${status}`, status);
  } catch (err) {
    if (err instanceof GptZeroError) throw err;
    if (timedOut) throw new GptZeroError("TIMEOUT", `GPTZero timed out after ${timeoutMs} ms`);
    throw new GptZeroError("NETWORK_ERROR", err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }
}
