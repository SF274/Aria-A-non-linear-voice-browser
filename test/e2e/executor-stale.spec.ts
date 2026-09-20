import { resolve } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { type DemoServerHandle, startDemoServer } from "./demo-server";
import {
  type ElementIndex,
  type ElementIndexEntry,
  type ExecuteRequest,
  type ExecuteResult,
} from "../../src/shared/contracts";

const distPath = resolve(import.meta.dirname, "..", "..", "dist");
const userDataDir = resolve(
  import.meta.dirname,
  "..",
  "..",
  ".playwright-user-data",
  "executor-stale"
);

let serverHandle: DemoServerHandle;

test.beforeAll(async () => {
  serverHandle = await startDemoServer();
});

test.afterAll(async () => {
  if (serverHandle) {
    await serverHandle.close();
  }
});

test.describe("Action Executor E2E (SPEC 7.6, 12.8, 12.10, 16 F-07)", () => {
  test("executes fill on demo page input, updates DOM state and dispatches events", async () => {
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
      const page = await ctx.newPage();

      const readinessLogSeen = new Promise<void>((resolveLog) => {
        page.on("console", (msg) => {
          if (msg.text().includes("[Aria] content script ready")) resolveLog();
        });
      });

      await page.goto(serverHandle.url);

      await Promise.race([
        readinessLogSeen,
        new Promise((_r, reject) =>
          setTimeout(() => reject(new Error("Timeout waiting for content script")), 5000)
        ),
      ]);

      await page.addScriptTag({ path: resolve(distPath, "src", "content", "index.js") });

      // Track events on the "From" input
      await page.evaluate(() => {
        const fromInput = document.querySelector<HTMLInputElement>("#from");
        if (fromInput) {
          (window as unknown as { __events__: string[] }).__events__ = [];
          fromInput.addEventListener("input", () => {
            (window as unknown as { __events__: string[] }).__events__.push("input");
          });
          fromInput.addEventListener("change", () => {
            (window as unknown as { __events__: string[] }).__events__.push("change");
          });
        }
      });

      // Build index and execute fill on "From" input
      const executeResult = await page.evaluate<ExecuteResult>(async () => {
        const getIndexFn = (window as unknown as { __ECHO_GET_INDEX__: () => ElementIndex })
          .__ECHO_GET_INDEX__;
        const execFn = (
          window as unknown as {
            __ECHO_EXECUTE_REQUEST__: (
              req: ExecuteRequest,
              opts?: { index?: ElementIndex }
            ) => Promise<ExecuteResult>;
          }
        ).__ECHO_EXECUTE_REQUEST__;

        const index = getIndexFn();
        const fromEntry = index.entries.find(
          (e: ElementIndexEntry) => e.role === "textbox" && e.name === "From"
        );
        if (!fromEntry) {
          throw new Error("From input not found in index");
        }

        const req: ExecuteRequest = {
          buildId: index.buildId,
          actions: [{ verb: "fill", elementId: fromEntry.id, value: "YVR" }],
          stepDelayMs: 0,
          playTicks: false,
        };

        return await execFn(req, { index });
      });

      expect(executeResult.ok).toBe(true);
      expect(executeResult.completed).toBe(1);
      expect(executeResult.results[0].status).toBe("ok");

      // Verify DOM value changed to "YVR"
      const inputValue = await page.$eval("#from", (el) => (el as HTMLInputElement).value);
      expect(inputValue).toBe("YVR");

      // Verify both events fired
      const firedEvents = await page.evaluate(() => (window as unknown as { __events__: string[] }).__events__);
      expect(firedEvents).toContain("input");
      expect(firedEvents).toContain("change");
    } finally {
      await ctx.close();
    }
  });

  test("removes target between resolve and execute: asserts not_found and batch abort (SPEC 12.10, 16 F-07)", async () => {
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
      const page = await ctx.newPage();

      const readinessLogSeen = new Promise<void>((resolveLog) => {
        page.on("console", (msg) => {
          if (msg.text().includes("[Aria] content script ready")) resolveLog();
        });
      });

      await page.goto(serverHandle.url);

      await Promise.race([
        readinessLogSeen,
        new Promise((_r, reject) =>
          setTimeout(() => reject(new Error("Timeout waiting for content script")), 5000)
        ),
      ]);

      await page.addScriptTag({ path: resolve(distPath, "src", "content", "index.js") });

      // Inject a temporary button, index it, remove it, then execute batch
      const result = await page.evaluate<ExecuteResult>(async () => {
        const tempBtn = document.createElement("button");
        tempBtn.id = "temp-btn";
        tempBtn.textContent = "Temporary Promo";
        document.body.appendChild(tempBtn);

        const indexFn = (window as unknown as { __ECHO_BUILD_INDEX__: () => ElementIndex })
          .__ECHO_BUILD_INDEX__;
        const execFn = (
          window as unknown as {
            __ECHO_EXECUTE_REQUEST__: (
              req: ExecuteRequest,
              opts?: { index?: ElementIndex }
            ) => Promise<ExecuteResult>;
          }
        ).__ECHO_EXECUTE_REQUEST__;

        const index = indexFn();
        const tempEntry = index.entries.find(
          (e: ElementIndexEntry) => e.name === "Temporary Promo"
        );
        const searchBtn = index.entries.find(
          (e: ElementIndexEntry) => e.name === "Search flights"
        );

        if (!tempEntry || !searchBtn) {
          throw new Error("Target entries not found");
        }

        // Remove the temporary element from the DOM (simulating stale DOM reference)
        tempBtn.remove();

        const req: ExecuteRequest = {
          buildId: index.buildId,
          actions: [
            { verb: "click", elementId: tempEntry.id }, // Stale element
            { verb: "click", elementId: searchBtn.id }, // Should abort and NOT execute
          ],
          stepDelayMs: 0,
          playTicks: false,
        };

        return await execFn(req, { index });
      });

      // Assert not_found and batch abort per SPEC 12.10 and 16 F-07
      expect(result.ok).toBe(false);
      expect(result.completed).toBe(0);
      expect(result.failedAtIndex).toBe(0);
      expect(result.results.length).toBe(1);
      expect(result.results[0].status).toBe("not_found");
    } finally {
      await ctx.close();
    }
  });

  test("buildId mismatch is rejected with status 'rejected' (SPEC 12.10, 16 F-07)", async () => {
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
      const page = await ctx.newPage();

      const readinessLogSeen = new Promise<void>((resolveLog) => {
        page.on("console", (msg) => {
          if (msg.text().includes("[Aria] content script ready")) resolveLog();
        });
      });

      await page.goto(serverHandle.url);

      await Promise.race([
        readinessLogSeen,
        new Promise((_r, reject) =>
          setTimeout(() => reject(new Error("Timeout waiting for content script")), 5000)
        ),
      ]);

      await page.addScriptTag({ path: resolve(distPath, "src", "content", "index.js") });

      const result = await page.evaluate<ExecuteResult>(async () => {
        const execFn = (
          window as unknown as {
            __ECHO_EXECUTE_REQUEST__: (req: ExecuteRequest) => Promise<ExecuteResult>;
          }
        ).__ECHO_EXECUTE_REQUEST__;

        const req: ExecuteRequest = {
          buildId: "stale-build-uuid-9999",
          actions: [{ verb: "click", elementId: "el_0" }],
          stepDelayMs: 0,
          playTicks: false,
        };

        return await execFn(req);
      });

      expect(result.ok).toBe(false);
      expect(result.completed).toBe(0);
      expect(result.results[0].status).toBe("rejected");
      expect(result.results[0].detail).toContain("buildId mismatch");
    } finally {
      await ctx.close();
    }
  });
});
