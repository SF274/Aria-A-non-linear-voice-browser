/**
 * SPEC 17.3: the test-only transcript bypass is compiled out of production
 * builds. The same must hold for the e2e determinism switch. `pnpm build`
 * (production) is what `dist/` holds; the QA suite builds a separate
 * development bundle into `dist-test/`.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");
const prodSw = resolve(root, "dist", "src", "sw", "index.js");
const devSw = resolve(root, "dist-test", "src", "sw", "index.js");

describe("dev-only hooks stay out of the production bundle (SPEC 17.3)", () => {
  it.skipIf(!existsSync(prodSw))("dist/ contains neither test.transcript nor the qa.ignoreStt switch", () => {
    const bundle = readFileSync(prodSw, "utf-8");
    expect(bundle).not.toContain("test.transcript");
    expect(bundle).not.toContain("qa.ignoreStt");
  });

  it.skipIf(!existsSync(devSw))("dist-test/ (development build) does contain them", () => {
    const bundle = readFileSync(devSw, "utf-8");
    expect(bundle).toContain("test.transcript");
    expect(bundle).toContain("qa.ignoreStt");
  });
});

/**
 * F-22 / HD-13. The GPTZero key lives on the same side of the boundary as the
 * Gemini key (R2.5): the service worker calls the classifier, and nothing about
 * it is compiled into the script that runs inside a page.
 */
describe("the synthetic-text detector stays in the service worker (HD-13, R2.5)", () => {
  const prodContent = resolve(root, "dist", "src", "content", "index.js");

  it.skipIf(!existsSync(prodSw))("the service worker is the one that talks to GPTZero", () => {
    expect(readFileSync(prodSw, "utf-8")).toContain("api.gptzero.me");
  });

  it.skipIf(!existsSync(prodSw))("the GPT_ZERO env var never reaches a bundle (HD-14)", () => {
    // It is a script-only variable, like COHERE_API_KEY. The extension takes its
    // key from the options page; a build that inlined the env var would put a
    // live key in a shipped artifact.
    expect(readFileSync(prodSw, "utf-8")).not.toContain("GPT_ZERO");
  });

  it.skipIf(!existsSync(prodContent))("the content script cannot call it", () => {
    const bundle = readFileSync(prodContent, "utf-8");
    expect(bundle).not.toContain("api.gptzero.me");
    expect(bundle).not.toContain("x-api-key");
    // `gptZeroApiKey` as a *name* is in this bundle, and that is not a leak:
    // `SettingsSchema` is shared and already carries `geminiApiKey` and
    // `elevenLabsApiKey` the same way. What must not be here is the means to
    // use a key — the endpoint and the header — and neither is.
  });
});
