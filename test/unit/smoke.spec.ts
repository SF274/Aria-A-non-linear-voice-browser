import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Assumes `pnpm build` has already run. `pnpm verify` runs it first.
const root = resolve(import.meta.dirname, "..", "..");
const builtManifestPath = resolve(root, "dist", "manifest.json");
const sourceManifestPath = resolve(root, "manifest.json");

describe("build pipeline (T0-01)", () => {
  it("produces dist/manifest.json", () => {
    expect(existsSync(builtManifestPath)).toBe(true);
  });

  it("copies the manifest verbatim as valid JSON", () => {
    const built = JSON.parse(readFileSync(builtManifestPath, "utf-8"));
    const source = JSON.parse(readFileSync(sourceManifestPath, "utf-8"));
    expect(built).toEqual(source);
  });
});
