import { resolve } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { type DemoServerHandle, startDemoServer } from "./demo-server";
import { type ElementIndex, type ElementIndexEntry } from "../../src/shared/contracts";

const distPath = resolve(import.meta.dirname, "..", "..", "dist");
const userDataDir = resolve(
  import.meta.dirname,
  "..",
  "..",
  ".playwright-user-data",
  "index-demo"
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

test.describe("Demo Page Element Index (SPEC 12, 16 F-04)", () => {
  test("builds complete, schema-valid index on demo page matching all F-04 criteria", async () => {
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
          if (msg.text().includes("[ECHO] content script ready")) resolveLog();
        });
      });

      await page.goto(serverHandle.url);

      await Promise.race([
        readinessLogSeen,
        new Promise((_r, reject) =>
          setTimeout(() => reject(new Error("Timeout waiting for content script")), 5000)
        ),
      ]);

      // Inject content bundle into page world if not already in main world
      await page.addScriptTag({ path: resolve(distPath, "src", "content", "index.js") });

      // Run index build and measure time
      const result = await page.evaluate<{ index: ElementIndex; duration: number }>(() => {
        const start = performance.now();
        const indexFn = (window as unknown as { __ECHO_BUILD_INDEX__: () => ElementIndex })
          .__ECHO_BUILD_INDEX__;
        const index = indexFn();
        const duration = performance.now() - start;
        return { index, duration };
      });

      const { index, duration } = result;

      // 1. Performance: under 120 ms
      console.log(`[E2E F-04] Demo page index build duration: ${duration.toFixed(2)} ms`);
      expect(duration).toBeLessThan(120);

      // 2. Serialized size: under 24 KB
      const serialized = JSON.stringify(index);
      const byteSize = new TextEncoder().encode(serialized).length;
      console.log(`[E2E F-04] Serialized demo index size: ${(byteSize / 1024).toFixed(2)} KB (${byteSize} bytes)`);
      expect(byteSize).toBeLessThan(24 * 1024);

      // 3. Exactly 25 elements: 4 nav, 3 filters, 4 search, 5 select, 7 booking, 2 download
      expect(index.entries.length).toBe(25);
      expect(index.truncated).toBe(false);

      // Check all 4 Navigation links (SPEC 15.3)
      const navNames = ["Home", "Flights", "Check-in", "Help"];
      for (const name of navNames) {
        const entry = index.entries.find((e: ElementIndexEntry) => e.role === "link" && e.name === name);
        expect(entry, `Expected link with accessible name "${name}"`).toBeDefined();
      }

      // Check 3 Filter checkboxes (SPEC 15.4)
      const filterNames = ["Morning departures", "Non-stop only", "Refundable fares"];
      for (const name of filterNames) {
        const entry = index.entries.find((e: ElementIndexEntry) => e.role === "checkbox" && e.name === name);
        expect(entry, `Expected checkbox with accessible name "${name}"`).toBeDefined();
      }

      // Check 4 Search controls (SPEC 15.5)
      const searchControls = [
        { role: "textbox", name: "From" },
        { role: "textbox", name: "To" },
        { role: "textbox", name: "Departure date" },
        { role: "button", name: "Search flights" },
      ];
      for (const { role, name } of searchControls) {
        const entry = index.entries.find((e: ElementIndexEntry) => e.role === role && e.name === name);
        expect(entry, `Expected ${role} with accessible name "${name}"`).toBeDefined();
      }

      // Check 5 Select buttons (SPEC 15.6)
      const selectButtons = [
        "Select 6:15 AM flight",
        "Select 9:40 AM flight",
        "Select 1:05 PM flight",
        "Select 4:30 PM flight",
        "Select 8:55 PM flight",
      ];
      for (const name of selectButtons) {
        const entry = index.entries.find((e: ElementIndexEntry) => e.role === "button" && e.name === name);
        expect(entry, `Expected button with accessible name "${name}"`).toBeDefined();
      }

      // Check 7 Booking controls (SPEC 15.7)
      const bookingControls = [
        { role: "textbox", name: "Passenger name" },
        { role: "textbox", name: "Email address" },
        { role: "combobox", name: "Seat preference" },
        { role: "radio", name: "Use saved card ending 4417" },
        { role: "radio", name: "Use a new card" },
        { role: "checkbox", name: "I accept the fare rules" },
        { role: "button", name: "Confirm booking" },
      ];
      for (const { role, name } of bookingControls) {
        const entry = index.entries.find((e: ElementIndexEntry) => e.role === role && e.name === name);
        expect(entry, `Expected ${role} with accessible name "${name}"`).toBeDefined();
      }

      // Check 2 Download buttons (SPEC 15.9)
      const downloadEntries = index.entries.filter(
        (e: ElementIndexEntry) => e.role === "button" && e.name === "Download"
      );
      expect(downloadEntries.length).toBe(2);

      // Check coordinate normalization: all x and y in [0, 1]
      for (const entry of index.entries) {
        expect(entry.x).toBeGreaterThanOrEqual(0);
        expect(entry.x).toBeLessThanOrEqual(1);
        expect(entry.y).toBeGreaterThanOrEqual(0);
        expect(entry.y).toBeLessThanOrEqual(1);
        expect(typeof entry.inViewport).toBe("boolean");
      }

      // 4. Verify no [data-echo] overlay elements are indexed (Exclusion 6)
      await page.evaluate(() => {
        const overlay = document.createElement("div");
        overlay.setAttribute("data-echo", "blackout");
        const btn = document.createElement("button");
        btn.textContent = "Overlay Button";
        overlay.appendChild(btn);
        document.body.appendChild(overlay);
      });

      const reindexed = await page.evaluate<ElementIndex>(() => {
        const indexFn = (window as unknown as { __ECHO_BUILD_INDEX__: () => ElementIndex })
          .__ECHO_BUILD_INDEX__;
        return indexFn();
      });
      const hasOverlayBtn = reindexed.entries.some((e: ElementIndexEntry) => e.name === "Overlay Button");
      expect(hasOverlayBtn).toBe(false);
      expect(reindexed.entries.length).toBe(25);
    } finally {
      await ctx.close();
    }
  });
});
