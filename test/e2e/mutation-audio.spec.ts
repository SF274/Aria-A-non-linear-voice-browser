/**
 * Mutation sonification in a real browser — T2-01, F-17 (SPEC 9.8).
 *
 * F-17's three criteria, each asserted here against real Web Audio:
 *   - clicking `Search flights` produces 5 tones at 70 ms spacing, beginning
 *     within 250 ms of the injection;
 *   - a page mutating 20 times per second produces at most one burst per
 *     1200 ms;
 *   - no tones fire during a scan or an execution batch.
 *
 * The content bundle is loaded into the page's main world rather than as an
 * extension. An extension content script runs in an isolated world that
 * `page.evaluate` cannot reach, and what needs checking here — the observer,
 * the rate limiter and the scheduler against a real `AudioContext` — is
 * identical in both worlds. It also lets this run headless, which is the
 * difference between a test that can run ten times in a row and one that
 * cannot.
 */

import { resolve } from "node:path";
import { type Browser, chromium, expect, test } from "@playwright/test";
import { MUTATION_RATE_LIMIT_MS } from "../../src/shared/constants";
import type { CueRecord } from "../../src/content/audio/engine";
import { type DemoServerHandle, startDemoServer } from "./demo-server";

const contentBundle = resolve(import.meta.dirname, "..", "..", "dist", "src", "content", "index.js");

// `__ECHO_AUDIO__` is declared by the content script itself
// (`src/content/index.ts`), so it is already in scope here.
declare global {
  interface Window {
    __INJECTED_AT__?: number;
    __CHURN_TIMER__?: number;
  }
}

let server: DemoServerHandle;
let browser: Browser;

test.beforeAll(async () => {
  server = await startDemoServer();
  browser = await chromium.launch({
    headless: true,
    // SPEC 9.6: Chrome starts an AudioContext suspended until a user gesture.
    // The extension resumes it inside the hold-to-talk keydown; a test has no
    // such gesture, so the policy is lifted instead of faked.
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
});

test.afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function openDemo() {
  const page = await browser.newPage({
    // Tall enough that all five injected flight cards are in the viewport:
    // SPEC 9.8 step 2 only sonifies additions that are, and F-17 asks for five.
    viewport: { width: 1280, height: 1600 },
  });
  await page.goto(server.url);
  await page.addScriptTag({ path: contentBundle });
  await page.waitForFunction(() => window.__ECHO_AUDIO__ !== undefined);
  // HD-12: the feature ships off (`settings.mutationAudio` defaults false), so
  // the suite turns it on explicitly rather than testing a disabled feature.
  await page.evaluate(() => window.__ECHO_AUDIO__!.startMutationAudio());

  const audioState = await page.evaluate(() => new AudioContext().state);
  expect(
    audioState,
    "the AudioContext must be running for any of this to be observable"
  ).toBe("running");

  return page;
}

/**
 * Split a log into bursts. Everything in one burst is scheduled by a single
 * synchronous call, so cues inside one share a wall-clock instant and the gap
 * to the next burst is at least the rate limit.
 */
function bursts(log: CueRecord[]): CueRecord[][] {
  const groups: CueRecord[][] = [];
  for (const cue of log) {
    const last = groups[groups.length - 1];
    if (last && cue.at - last[0].at < 500) last.push(cue);
    else groups.push([cue]);
  }
  return groups;
}

test("clicking Search flights produces five tones at 70 ms spacing, within 250 ms of the injection", async () => {
  const page = await openDemo();
  try {
    // Record the instant the results actually land, on the page's own clock,
    // so the 250 ms is measured against the injection and not against the click.
    await page.evaluate(() => {
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of Array.from(record.addedNodes)) {
            if (node instanceof HTMLElement && node.classList.contains("flight-card")) {
              window.__INJECTED_AT__ = Date.now();
              observer.disconnect();
              return;
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      window.__ECHO_AUDIO__!.clear();
    });

    await page.click("#search-btn");
    // RESULTS_DELAY_MS is 800; give the index debounce and the burst room after it.
    await page.waitForFunction(
      () => (window.__ECHO_AUDIO__?.log().filter((c) => c.layer === "point").length ?? 0) >= 5,
      undefined,
      { timeout: 5000 }
    );

    const { log, injectedAt } = await page.evaluate(() => ({
      log: window.__ECHO_AUDIO__!.log(),
      injectedAt: window.__INJECTED_AT__,
    }));

    const tones = log.filter((c) => c.layer === "point");
    expect(tones).toHaveLength(5);

    // 70 ms apart, scheduled up front against the context clock, so the spacing
    // is exact rather than however setTimeout felt at the time.
    for (let i = 1; i < tones.length; i++) {
      expect((tones[i].when - tones[i - 1].when) * 1000).toBeCloseTo(70, 3);
    }

    expect(injectedAt).toBeDefined();
    const latency = tones[0].at - injectedAt!;
    console.log(`[E2E F-17] first tone ${latency} ms after injection`);
    expect(latency).toBeLessThan(250);

    // The five results arrived as five cards, so the swell should be under them.
    expect(log.filter((c) => c.layer === "swell").length).toBe(1);

    // Sorted top to bottom (SPEC 9.8 step 3), so pitch descends down the page.
    for (let i = 1; i < tones.length; i++) {
      expect(tones[i].freqHz).toBeLessThanOrEqual(tones[i - 1].freqHz);
    }
  } finally {
    await page.close();
  }
});

test("a page mutating 20 times a second produces at most one burst per 1200 ms", async () => {
  const page = await openDemo();
  try {
    await page.evaluate(() => {
      window.__ECHO_AUDIO__!.clear();
      const host = document.createElement("div");
      host.id = "churn-host";
      document.body.appendChild(host);
      window.__CHURN_TIMER__ = window.setInterval(() => {
        const line = document.createElement("p");
        line.textContent = `tick ${Date.now()}`;
        host.appendChild(line);
        // Keep the DOM bounded; this is a polling widget, not a memory test.
        if (host.children.length > 20) host.removeChild(host.firstChild!);
      }, 50);
    });

    const durationMs = 3000;
    await page.waitForTimeout(durationMs);
    await page.evaluate(() => window.clearInterval(window.__CHURN_TIMER__!));
    await page.waitForTimeout(400);

    const log = await page.evaluate(() => window.__ECHO_AUDIO__!.log());
    const groups = bursts(log);
    console.log(`[E2E F-17] ${groups.length} bursts in ${durationMs} ms of 20 Hz mutation`);

    // Something must be audible, or the rate limit is not what is being tested.
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.length).toBeLessThanOrEqual(Math.ceil(durationMs / MUTATION_RATE_LIMIT_MS));

    for (let i = 1; i < groups.length; i++) {
      const gap = groups[i][0].at - groups[i - 1][0].at;
      expect(gap).toBeGreaterThanOrEqual(MUTATION_RATE_LIMIT_MS - 10);
    }
  } finally {
    await page.close();
  }
});

test("no tones fire while an execution batch is running, and they resume after it", async () => {
  const page = await openDemo();
  try {
    await page.evaluate(() => {
      window.__ECHO_AUDIO__!.clear();
      window.__ECHO_AUDIO__!.beginActivity("batch");
    });

    await page.click("#search-btn");
    await page.waitForTimeout(1400);

    const duringBatch = await page.evaluate(() => window.__ECHO_AUDIO__!.log());
    expect(duringBatch, "a batch suppresses mutation sound entirely (SPEC 9.8 step 5)").toHaveLength(0);

    // End the batch: the page is audible again, and the rate limit was never
    // spent on the burst that was suppressed.
    await page.evaluate(() => {
      window.__ECHO_AUDIO__!.endActivity("batch");
      const host = document.createElement("div");
      host.id = "after-batch";
      document.body.appendChild(host);
      // Appended one at a time, into the live document: a subtree built
      // detached and attached in one go is a single element addition, which is
      // deliberately below the threshold (it is what a spinner looks like).
      for (let i = 0; i < 6; i++) {
        const line = document.createElement("p");
        line.textContent = `row ${i}`;
        host.appendChild(line);
      }
    });

    await page.waitForFunction(() => (window.__ECHO_AUDIO__?.log().length ?? 0) > 0, undefined, {
      timeout: 3000,
    });
    expect((await page.evaluate(() => window.__ECHO_AUDIO__!.log())).length).toBeGreaterThan(0);
  } finally {
    await page.close();
  }
});
