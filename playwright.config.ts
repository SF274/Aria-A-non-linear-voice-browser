import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    // Use the system-installed Chrome channel (SPEC 17.2) rather than
    // Playwright's bundled Chromium, so no separate browser download is
    // required on a machine that already has Chrome.
    channel: "chrome",
    headless: true,
  },
});
