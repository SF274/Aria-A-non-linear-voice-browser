import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type BuildOptions } from "vite";

// This bundler is hand-rolled instead of using @crxjs/vite-plugin (SPEC/TASKS
// T0-01 permits "an equivalent MV3 bundler"). Reason: @crxjs parses
// manifest.json at config-load time and expects every referenced entry
// point (service worker, content scripts, extension pages) to already
// exist. This repository builds those entry points incrementally across
// many later tasks, so a manifest-driven bundler would break on every
// commit until the last entry point lands. See state/DECISIONS.md D-011.
//
// The actual multi-entry build is `scripts/build.ts`, run via `pnpm build`.
// It runs one single-input Vite build per entry (see the comment on
// ENTRY_OUTPUT for why) and imports the shared pieces below. This file's
// own `export default` exists so editor/IDE tooling that expects a real
// Vite config at the project root finds one; it is not on the `pnpm build`
// path.

export const root = resolve(import.meta.dirname);
export const outDir = resolve(root, "dist");

/** Fixed set of entry points named across SPEC 4 and TASKS.md. Only the ones
 * that exist on disk are bundled; this lets `pnpm build` succeed at every
 * point in the task graph, not just once every component exists. */
export const CANDIDATE_ENTRIES: Record<string, string> = {
  "src/sw/index": "src/sw/index.ts",
  "src/content/index": "src/content/index.ts",
  "src/offscreen/index": "src/offscreen/index.html",
  "src/pages/permission": "src/pages/permission.html",
  "src/pages/mic": "src/pages/mic.html",
  "src/pages/options": "src/pages/options.html",
};

export function resolveEntries(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const [name, relPath] of Object.entries(CANDIDATE_ENTRIES)) {
    const abs = resolve(root, relPath);
    if (existsSync(abs)) entries[name] = abs;
  }
  return entries;
}

/**
 * MV3 content scripts always run as classic (non-module) scripts — there is
 * no "type": "module" option for content_scripts, unlike the service
 * worker. A static ES `import` in a content-script bundle throws a
 * SyntaxError the moment Chrome injects it. IIFE output disallows chunk
 * splitting entirely (Rollup/rolldown reject a multi-entry IIFE build that
 * would need a shared chunk), so every entry is built as its own
 * single-input pass with no cross-entry shared chunk possible.
 */
export const ENTRY_OUTPUT: NonNullable<BuildOptions["rollupOptions"]>["output"] = {
  format: "iife",
  entryFileNames: "[name].js",
  assetFileNames: "assets/[name]-[hash][extname]",
};

/** Copies and JSON-validates the root manifest.json into dist/ after all
 * entries are built. A malformed manifest fails the build loudly rather
 * than shipping a broken extension. */
export function copyManifest(): void {
  const manifestPath = resolve(root, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error("manifest.json is missing at the project root.");
  }
  const raw = readFileSync(manifestPath, "utf-8");
  JSON.parse(raw); // throws on malformed JSON
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "manifest.json"), raw);
}

export default defineConfig(({ mode }) => ({
  root,
  define: {
    // SPEC §17.3: test.transcript bypass is compiled out of production builds.
    // In dev and test modes, __ECHO_DEV__ evaluates to true.
    __ECHO_DEV__: mode !== "production",
  },
  build: {
    outDir,
    target: "es2022",
    rollupOptions: {
      output: ENTRY_OUTPUT,
    },
  },
}));
