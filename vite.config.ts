import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

// This bundler is hand-rolled instead of using @crxjs/vite-plugin (SPEC/TASKS
// T0-01 permits "an equivalent MV3 bundler"). Reason: @crxjs parses
// manifest.json at config-load time and expects every referenced entry
// point (service worker, content scripts, extension pages) to already
// exist. This repository builds those entry points incrementally across
// many later tasks, so a manifest-driven bundler would break on every
// commit until the last entry point lands. See state/DECISIONS.md.

const root = resolve(import.meta.dirname);
const outDir = resolve(root, "dist");

// Fixed set of entry points named across SPEC 4 and TASKS.md. Only the ones
// that exist on disk are bundled; this lets `pnpm build` succeed at every
// point in the task graph, not just once every component exists.
const CANDIDATE_ENTRIES: Record<string, string> = {
  "src/sw/index": "src/sw/index.ts",
  "src/content/index": "src/content/index.ts",
  "src/offscreen/index": "src/offscreen/index.html",
  "src/pages/permission": "src/pages/permission.html",
  "src/pages/mic": "src/pages/mic.html",
  "src/pages/options": "src/pages/options.html",
};

function resolveEntries(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const [name, relPath] of Object.entries(CANDIDATE_ENTRIES)) {
    const abs = resolve(root, relPath);
    if (existsSync(abs)) entries[name] = abs;
  }
  return entries;
}

const NOOP_ENTRY_ID = "virtual:echo-noop-entry";
const NOOP_ENTRY_KEY = "__noop__";

/** Rollup requires at least one input. Before any real entry point exists
 * (true only very early in the build), substitute a virtual empty module so
 * `vite build` still runs and still copies manifest.json. */
function noopEntryPlugin(): Plugin {
  return {
    name: "echo-noop-entry",
    resolveId(id) {
      return id === NOOP_ENTRY_ID ? NOOP_ENTRY_ID : null;
    },
    load(id) {
      return id === NOOP_ENTRY_ID ? "export {};\n" : null;
    },
  };
}

/** Copies and JSON-validates the root manifest.json into dist/ on every
 * build. A malformed manifest fails the build loudly rather than shipping a
 * broken extension. */
function copyManifestPlugin(): Plugin {
  return {
    name: "echo-copy-manifest",
    writeBundle() {
      const manifestPath = resolve(root, "manifest.json");
      if (!existsSync(manifestPath)) {
        throw new Error("manifest.json is missing at the project root.");
      }
      const raw = readFileSync(manifestPath, "utf-8");
      JSON.parse(raw); // throws on malformed JSON
      mkdirSync(outDir, { recursive: true });
      writeFileSync(resolve(outDir, "manifest.json"), raw);
    },
  };
}

const realEntries = resolveEntries();
const input =
  Object.keys(realEntries).length > 0 ? realEntries : { [NOOP_ENTRY_KEY]: NOOP_ENTRY_ID };

export default defineConfig({
  root,
  build: {
    outDir,
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input,
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  plugins: [noopEntryPlugin(), copyManifestPlugin()],
});
