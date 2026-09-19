import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

// Assumes `pnpm build` has already run. `pnpm verify` runs it first.
// This is a placeholder until T0-03/T0-04 land: it proves the build output
// exists and that Playwright can drive the system Chrome install. Real
// extension-loading e2e coverage (SPEC 17.2, IG-04) arrives with T0-03.
const distManifestPath = resolve(import.meta.dirname, "..", "..", "dist", "manifest.json");

test("build output exists and Playwright can drive Chrome", async ({ page }) => {
  expect(existsSync(distManifestPath)).toBe(true);

  await page.goto("about:blank");
  expect(page.url()).toBe("about:blank");
});
