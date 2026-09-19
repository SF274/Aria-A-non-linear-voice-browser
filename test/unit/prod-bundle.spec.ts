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
