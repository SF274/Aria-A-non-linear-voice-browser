import { expect, test } from "@playwright/test";
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

test.describe("Demo page accessible names and static structure (SPEC 15, F-16a)", () => {
  test("every accessible name in SPEC 15 exists exactly once except the two intentional duplicates", async ({ page }) => {
    await page.goto(serverHandle.url);

    // SPEC 15.3 — Navigation (4 anchors)
    const navNames = ["Home", "Flights", "Check-in", "Help"];
    for (const name of navNames) {
      const links = page.getByRole("link", { name, exact: true });
      await expect(links, `Expected exactly one link named "${name}"`).toHaveCount(1);
    }

    // SPEC 15.4 — Sidebar filters (3 checkboxes)
    const filterNames = ["Morning departures", "Non-stop only", "Refundable fares"];
    for (const name of filterNames) {
      const checkboxes = page.getByRole("checkbox", { name, exact: true });
      await expect(checkboxes, `Expected exactly one checkbox named "${name}"`).toHaveCount(1);
    }

    // SPEC 15.5 — Search bar (4 controls)
    const searchInputs = [
      { role: "textbox" as const, name: "From" },
      { role: "textbox" as const, name: "To" },
      { role: "textbox" as const, name: "Departure date" },
      { role: "button" as const, name: "Search flights" },
    ];
    for (const { role, name } of searchInputs) {
      const elements = page.getByRole(role, { name, exact: true });
      await expect(elements, `Expected exactly one ${role} named "${name}"`).toHaveCount(1);
    }

    // SPEC 15.6 — Results (5 cards, each button unique)
    const resultButtons = [
      "Select 6:15 AM flight",
      "Select 9:40 AM flight",
      "Select 1:05 PM flight",
      "Select 4:30 PM flight",
      "Select 8:55 PM flight",
    ];
    for (const name of resultButtons) {
      const buttons = page.getByRole("button", { name, exact: true });
      await expect(buttons, `Expected exactly one button named "${name}"`).toHaveCount(1);
    }

    // SPEC 15.7 — Booking form (7 controls)
    const bookingControls = [
      { role: "textbox" as const, name: "Passenger name" },
      { role: "textbox" as const, name: "Email address" },
      { role: "combobox" as const, name: "Seat preference" },
      { role: "radio" as const, name: "Use saved card ending 4417" },
      { role: "radio" as const, name: "Use a new card" },
      { role: "checkbox" as const, name: "I accept the fare rules" },
      { role: "button" as const, name: "Confirm booking" },
    ];
    for (const { role, name } of bookingControls) {
      const elements = page.getByRole(role, { name, exact: true });
      await expect(elements, `Expected exactly one ${role} named "${name}"`).toHaveCount(1);
    }

    // SPEC 15.9 — Two footer buttons both with accessible name exactly "Download"
    const downloadButtons = page.getByRole("button", { name: "Download", exact: true });
    await expect(downloadButtons, "Expected exactly two buttons named 'Download' (intentional duplicate)").toHaveCount(2);

    // Verify IDs of both download buttons
    const dlPdf = page.locator("#dl-pdf");
    const dlWord = page.locator("#dl-word");
    await expect(dlPdf).toHaveAttribute("aria-label", "Download");
    await expect(dlWord).toHaveAttribute("aria-label", "Download");
  });

  test("the page contains no password inputs (SPEC 15.7, R2.4)", async ({ page }) => {
    await page.goto(serverHandle.url);
    const passwordInputs = page.locator('input[type="password"]');
    await expect(passwordInputs).toHaveCount(0);
  });

  test("the promo video is present, muted, and has heading 'Summer sale' (SPEC 15.10)", async ({ page }) => {
    await page.goto(serverHandle.url);

    const heading = page.getByRole("heading", { name: "Summer sale", exact: true });
    await expect(heading).toBeVisible();

    const video = page.locator("video");
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute("muted", "");
  });

  test("results region has aria-live='polite' (SPEC 15.11)", async ({ page }) => {
    await page.goto(serverHandle.url);
    const results = page.locator("#results");
    await expect(results).toHaveAttribute("aria-live", "polite");
  });

  test("all major landmarks exist (SPEC 15.11)", async ({ page }) => {
    await page.goto(serverHandle.url);
    await expect(page.locator("nav")).toHaveCount(1);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("footer")).toHaveCount(1);
    await expect(page.locator("aside")).toHaveCount(2); // sidebar filters & promo panel
  });
});
