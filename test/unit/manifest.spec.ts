import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "..", "..", "manifest.json"), "utf-8")
) as {
  manifest_version: number;
  permissions?: string[];
  host_permissions?: string[];
};

/** SPEC 8.7: exactly these six, character for character, no others. */
const SPEC_8_7_PERMISSIONS = ["offscreen", "storage", "tts", "tabs", "scripting", "bookmarks"];

/** SPEC 8.7 `[REQUIREMENT]`: none of these may ever be requested. */
const FORBIDDEN_PERMISSIONS = [
  "debugger",
  "downloads",
  "history",
  "cookies",
  "webRequest",
  "activeTab",
  "nativeMessaging",
];

describe("manifest.json permission surface (SPEC 8.7)", () => {
  it("is manifest_version 3", () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it("requests exactly the six SPEC 8.7 permissions, character for character", () => {
    expect([...(manifest.permissions ?? [])].sort()).toEqual([...SPEC_8_7_PERMISSIONS].sort());
  });

  it("requests exactly the SPEC 8.7 host permission", () => {
    expect(manifest.host_permissions).toEqual(["<all_urls>"]);
  });

  it("never requests a forbidden permission", () => {
    for (const forbidden of FORBIDDEN_PERMISSIONS) {
      expect(manifest.permissions ?? []).not.toContain(forbidden);
    }
  });
});
