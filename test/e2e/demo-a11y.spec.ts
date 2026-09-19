import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { type DemoServerHandle, startDemoServer } from "./demo-server.js";

let serverHandle: DemoServerHandle;

test.beforeAll(async () => {
  serverHandle = await startDemoServer();
});

test.afterAll(async () => {
  if (serverHandle) {
    await serverHandle.close();
  }
});

test.describe("Demo page accessibility (axe-core, SPEC 17.1, F-16a)", () => {
  test("axe-core reports zero violations of serious or critical severity", async ({ page }) => {
    await page.goto(serverHandle.url);

    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();

    const seriousOrCritical = accessibilityScanResults.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );

    if (seriousOrCritical.length > 0) {
      console.error(
        "Axe-core accessibility violations (serious/critical):",
        JSON.stringify(seriousOrCritical, null, 2)
      );
    }

    expect(seriousOrCritical).toEqual([]);
  });
});
