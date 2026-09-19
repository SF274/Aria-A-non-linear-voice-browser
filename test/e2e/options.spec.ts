import { resolve } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { startDemoServer } from "./demo-server";

const distPath = resolve(import.meta.dirname, "..", "..", "dist");
const userDataDir = resolve(
  import.meta.dirname,
  "..",
  "..",
  ".playwright-user-data",
  "options-e2e"
);

test.describe("Options page (SPEC 5.13, 8.6, 10.3, 13.1, 16 F-21)", () => {
  test("persists API key across restarts, never renders it into other pages' DOM, and provides runnable gate buttons", async () => {
    const server = await startDemoServer(0);

    const ctx = await chromium.launchPersistentContext(userDataDir, {
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
      // Step 1: Open demo page to wake the extension and ensure content script injects
      const demoPage = await ctx.newPage();
      const readyPromise = new Promise<void>((resolveReady) => {
        demoPage.on("console", (msg) => {
          if (msg.text().includes("[ECHO] content script ready")) resolveReady();
        });
      });

      await demoPage.goto(server.url);
      await Promise.race([
        readyPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout waiting for content script readiness")), 5000)
        ),
      ]);

      // Obtain extension ID
      let sw = ctx.serviceWorkers().find((s) => s.url().endsWith("/src/sw/index.js"));
      if (!sw) {
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 100));
          sw = ctx.serviceWorkers().find((s) => s.url().endsWith("/src/sw/index.js"));
          if (sw) break;
        }
      }
      expect(sw).toBeDefined();
      const extId = new URL(sw!.url()).host;

      // Step 2: Open options page
      const optionsPage = await ctx.newPage();
      const consoleLogs: string[] = [];
      optionsPage.on("console", (msg) => {
        consoleLogs.push(msg.text());
      });

      await optionsPage.goto(`chrome-extension://${extId}/src/pages/options.html`);

      // Verify all controls exist per SPEC 16 F-21 and TASKS T0-12
      const apiKeyInput = optionsPage.locator("#gemini-api-key");
      const modelInput = optionsPage.locator("#gemini-model");
      const verbositySelect = optionsPage.locator("#verbosity");
      const saveBtn = optionsPage.locator("#btn-save");
      const sttModeDisplay = optionsPage.locator("#stt-mode-display");
      const installBtn = optionsPage.locator("#btn-install-model");

      const btnIG01 = optionsPage.locator("#btn-gate-ig01");
      const btnIG03 = optionsPage.locator("#btn-gate-ig03");
      const btnIG06 = optionsPage.locator("#btn-gate-ig06");
      const btnIG10 = optionsPage.locator("#btn-gate-ig10");

      await expect(apiKeyInput).toBeVisible();
      await expect(modelInput).toBeVisible();
      await expect(verbositySelect).toBeVisible();
      await expect(saveBtn).toBeVisible();
      await expect(sttModeDisplay).toBeVisible();
      await expect(installBtn).toBeVisible();
      await expect(btnIG01).toBeVisible();
      await expect(btnIG03).toBeVisible();
      await expect(btnIG06).toBeVisible();
      await expect(btnIG10).toBeVisible();

      // Step 3: Enter and save API key and customized settings
      const SECRET_KEY = "test-secret-gemini-key-123456";
      await apiKeyInput.fill(SECRET_KEY);
      await modelInput.fill("gemini-test-custom-override");
      await verbositySelect.selectOption("verbose");

      await saveBtn.click();
      await expect(optionsPage.locator("#save-status")).toContainText("Settings saved successfully.");

      // Step 4: Verify settings were persisted into chrome.storage.local
      const storedSettings = await optionsPage.evaluate(async () => {
        const data = await chrome.storage.local.get("settings");
        return data.settings as {
          geminiApiKey: string | null;
          geminiModel: string;
          verbosity: string;
          ttsRate: number;
        };
      });

      expect(storedSettings.geminiApiKey).toBe(SECRET_KEY);
      expect(storedSettings.geminiModel).toBe("gemini-test-custom-override");
      expect(storedSettings.verbosity).toBe("verbose");
      expect(storedSettings.ttsRate).toBe(1.0);

      // Step 5: Reload options page to assert persistence
      await optionsPage.reload();
      await expect(apiKeyInput).toHaveValue(SECRET_KEY);
      await expect(modelInput).toHaveValue("gemini-test-custom-override");
      await expect(verbositySelect).toHaveValue("verbose");

      // Step 6: Assert API key is NEVER rendered into the DOM of any other page (SPEC 8.6, 16 F-21)
      const demoHtml = await demoPage.content();
      expect(demoHtml).not.toContain(SECRET_KEY);

      const demoText = await demoPage.innerText("body");
      expect(demoText).not.toContain(SECRET_KEY);

      const demoHtmlContainsSecret = await demoPage.evaluate((key) => {
        return document.documentElement.outerHTML.includes(key);
      }, SECRET_KEY);
      expect(demoHtmlContainsSecret).toBe(false);

      // Verify that secret key is not leaked elsewhere in storage
      const allStorage = (await optionsPage.evaluate(async () => {
        return await chrome.storage.local.get(null);
      })) as { settings?: Record<string, unknown> };
      expect(allStorage.settings?.geminiApiKey).toBe(SECRET_KEY);
      const storageWithoutKey = {
        ...allStorage,
        settings: { ...allStorage.settings, geminiApiKey: null },
      };
      expect(JSON.stringify(storageWithoutKey)).not.toContain(SECRET_KEY);

      await demoPage.close();

      // Step 7: Test gate runner buttons output copy-pasteable markdown blocks to console
      await btnIG01.click();
      await btnIG03.click();
      await btnIG06.click();
      await btnIG10.click();

      // Poll until each gate outputs its copy-pasteable block
      await expect
        .poll(() => consoleLogs.some((l) => l.includes("### IG-01 — On-device STT available")), {
          timeout: 6000,
        })
        .toBe(true);

      await expect
        .poll(
          () =>
            consoleLogs.some((l) =>
              l.includes("### IG-03 — chrome.tts speaks a chunked 60 s passage to completion")
            ),
          { timeout: 6000 }
        )
        .toBe(true);

      await expect
        .poll(
          () =>
            consoleLogs.some((l) =>
              l.includes("### IG-06 — Gemini model identifier valid, responseSchema honoured")
            ),
          { timeout: 6000 }
        )
        .toBe(true);

      await expect
        .poll(
          () =>
            consoleLogs.some((l) =>
              l.includes("### IG-10 — Convex write succeeds from an MV3 service worker")
            ),
          { timeout: 6000 }
        )
        .toBe(true);
    } finally {
      await ctx.close();
      await server.close();
    }
  });
});
