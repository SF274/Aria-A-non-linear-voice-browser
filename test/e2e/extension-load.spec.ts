import { resolve } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { startDemoServer } from "./demo-server";

// Assumes `pnpm build` has already run. `pnpm verify` runs it first.
//
// Exercises SPEC 17.2's extension-loading pattern and F-01's SPEC 16
// criterion: "extension loads with zero console errors" and the content
// script "injects into the demo page and logs a single readiness line."
// The offscreen document (SPEC 4.3) does not exist until T0-09, so this is
// not yet the full IG-04 gate (SPEC 17.2's "service worker reachable via
// ctx.serviceWorkers()" with an offscreen document) — just what T0-03 can
// verify on its own.
//
// [GATE: IG-04 finding] SPEC 17.2's snippet passes `channel: "chrome"`.
// On this machine (real, branded Google Chrome 152.0.7977.83), Chrome
// silently ignores `--disable-extensions-except` / `--load-extension`
// ("--disable-extensions-except is not allowed in Google Chrome, ignoring."
// — confirmed via `--enable-logging --log-file`), so no service worker ever
// registers and the content script never injects. Playwright's own bundled
// Chromium (omit `channel` entirely) honours both flags. This is a real
// environment fact, not a workaround for a bug in this codebase: recorded
// in state/INTEGRATION_GATES.md and state/DEVIATIONS.md DEV-002. Every
// future extension-loading e2e test (chain.spec.ts, golden-path.spec.ts,
// the security suite, scan-sync, blackout) must omit `channel` for the
// same reason.
const distPath = resolve(import.meta.dirname, "..", "..", "dist");
const userDataDir = resolve(
  import.meta.dirname,
  "..",
  "..",
  ".playwright-user-data",
  "extension-load"
);

test("extension loads with zero console errors and the content script announces readiness on the demo page", async () => {
  const server = await startDemoServer(0);
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    // Classic headless mode does not support extensions at all (SPEC 17.2's
    // own snippet omits `headless` for exactly this reason — confirmed
    // empirically here too). Headed is required for any extension-loading
    // test.
    headless: false,
    args: [
      `--disable-extensions-except=${distPath}`,
      `--load-extension=${distPath}`,
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  try {
    // Scoped to errors the extension itself causes (console.error whose
    // source is a chrome-extension:// URL). The demo page fixture (T0-04,
    // gemini) can have its own unrelated script bugs — asserting on the
    // whole page's console would conflate two independent systems. See
    // state/NOTES.md N-009 for a bug observed in demo/app.js this way.
    const extensionErrors: string[] = [];
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error" && msg.location().url.startsWith("chrome-extension://")) {
        extensionErrors.push(msg.text());
      }
    });

    const readinessLogSeen = new Promise<void>((resolveLog) => {
      page.on("console", (msg) => {
        if (msg.text().includes("[Aria] content script ready")) resolveLog();
      });
    });

    await page.goto(server.url);
    console.log("[DEBUG] serviceWorkers:", ctx.serviceWorkers().map((sw) => sw.url()));
    await new Promise((r) => setTimeout(r, 1000));
    console.log("[DEBUG] serviceWorkers after 1s:", ctx.serviceWorkers().map((sw) => sw.url()));
    await Promise.race([
      readinessLogSeen,
      new Promise((_resolve, reject) =>
        setTimeout(
          () => reject(new Error("timed out waiting for content script readiness log")),
          5000
        )
      ),
    ]);

    expect(extensionErrors).toEqual([]);

    const serviceWorkerUrls = ctx.serviceWorkers().map((sw) => sw.url());
    expect(serviceWorkerUrls.some((url) => url.endsWith("/src/sw/index.js"))).toBe(true);
  } finally {
    await ctx.close();
    await server.close();
  }
});
