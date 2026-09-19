#!/usr/bin/env node
/**
 * The real `pnpm build` entry point. Runs Node 24's built-in TypeScript
 * type-stripping directly (`node scripts/build.ts`) — no bundler or
 * transpile step needed for this script itself.
 *
 * Builds each entry point in `vite.config.ts`'s `CANDIDATE_ENTRIES` as its
 * own single-input Vite build (see `vite.config.ts`'s `ENTRY_OUTPUT` comment
 * for why a single multi-entry IIFE build cannot be used), then copies
 * `manifest.json` into `dist/`.
 */

import { rmSync } from "node:fs";
import { build as viteBuild } from "vite";
import { copyManifest, ENTRY_OUTPUT, outDir, resolveEntries, root } from "../vite.config.ts";

async function buildEntry(name: string, entryPath: string): Promise<void> {
  await viteBuild({
    root,
    configFile: false,
    logLevel: "warn",
    build: {
      outDir,
      emptyOutDir: false, // the whole dist/ dir is cleared once, up front, below
      target: "es2022",
      rollupOptions: {
        input: { [name]: entryPath },
        output: ENTRY_OUTPUT,
      },
    },
  });
}

async function main(): Promise<void> {
  rmSync(outDir, { recursive: true, force: true });

  const entries = Object.entries(resolveEntries());
  if (entries.length === 0) {
    console.log("[build] no entry points exist yet; copying manifest.json only.");
  }
  for (const [name, entryPath] of entries) {
    await buildEntry(name, entryPath);
  }

  copyManifest();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
