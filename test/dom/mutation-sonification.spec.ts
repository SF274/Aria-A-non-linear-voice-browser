/**
 * The mutation sonifier's observer — T2-01 (F-17), SPEC 9.8 and 12.9.
 *
 * `mutation-audio.spec.ts` covers what a burst sounds like. This covers how a
 * burst is gathered: what the observer counts, what it refuses to do on the
 * page's hot path, and which trigger wins when a mutation changes both the text
 * and the set of controls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MUTATION_CHURN_DEBOUNCE_MS,
  MUTATION_GEOMETRY_SAMPLE_CAP,
} from "../../src/shared/constants";
import type { ElementIndex, MutationEvent } from "../../src/shared/contracts";
import { getAudioLog, resetAudioEngine } from "../../src/content/audio/engine";
import {
  type MutationSonifierHandle,
  startMutationSonification,
} from "../../src/content/audio/mutation";
import { installFakeAudioContext } from "../support/fake-audio-context";

let sonifier: MutationSonifierHandle | null = null;

beforeEach(() => {
  resetAudioEngine();
  installFakeAudioContext(vi.stubGlobal);
  document.body.innerHTML = "";
});

afterEach(() => {
  sonifier?.disconnect();
  sonifier = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetAudioEngine();
});

/** Let jsdom deliver the queued MutationObserver records. */
function deliverRecords(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function indexWith(entries: Array<{ id: string; x: number; y: number }>): ElementIndex {
  return {
    buildId: "build-2",
    builtAt: Date.now(),
    url: "https://example.test/",
    title: "Test",
    viewportW: 1280,
    viewportH: 800,
    docH: 2000,
    truncated: false,
    entries: entries.map((e) => ({
      id: e.id,
      role: "button",
      name: e.id,
      nameKey: e.id,
      x: e.x,
      y: e.y,
      enabled: true,
      visible: true,
      inViewport: true,
      value: null,
      tag: "button",
      inputType: null,
      isPassword: false,
    })),
  };
}

function changedEvent(addedIds: string[]): MutationEvent {
  return { buildId: "build-2", addedIds, removedIds: [], at: Date.now(), };
}

describe("the hot path does no layout work", () => {
  it("never measures or queries while records are being counted", async () => {
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
    const query = vi.spyOn(Element.prototype, "querySelectorAll");
    sonifier = startMutationSonification();

    // The kind of storm a framework re-render produces.
    for (let i = 0; i < 400; i++) {
      const div = document.createElement("div");
      div.textContent = `row ${i}`;
      document.body.appendChild(div);
    }
    await deliverRecords();

    // Records have been counted; nothing has flushed yet.
    expect(rect).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("measures at most a bounded sample once it does flush", async () => {
    sonifier = startMutationSonification();
    for (let i = 0; i < 400; i++) {
      const div = document.createElement("div");
      div.appendChild(document.createElement("span"));
      document.body.appendChild(div);
    }
    await deliverRecords();

    const query = vi.spyOn(Element.prototype, "querySelectorAll");
    sonifier.flushNow(10_000);
    expect(query.mock.calls.length).toBeLessThanOrEqual(MUTATION_GEOMETRY_SAMPLE_CAP);
  });
});

describe("what counts as page activity", () => {
  it("ignores our own overlays (SPEC 12.9 step 4)", async () => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-echo", "overlay");
    document.body.appendChild(overlay);
    await deliverRecords();

    sonifier = startMutationSonification();
    for (let i = 0; i < 10; i++) {
      overlay.appendChild(document.createElement("div"));
    }
    await deliverRecords();
    expect(sonifier.flushNow(10_000)).toBe("below-threshold");
  });

  it("counts text edits that never reach the element index", async () => {
    const paragraph = document.createElement("p");
    const text = document.createTextNode("0 results");
    paragraph.appendChild(text);
    document.body.appendChild(paragraph);
    await deliverRecords();

    sonifier = startMutationSonification();
    text.data = "1 result";
    text.data = "2 results";
    text.data = "3 results";
    await deliverRecords();

    expect(sonifier.flushNow(10_000)).toBe("played");
    expect(getAudioLog().filter((c) => c.layer === "churn").length).toBeGreaterThan(0);
  });

  it("stays quiet for a single element swapping in — that is a spinner, not an event", async () => {
    sonifier = startMutationSonification();
    const spinner = document.createElement("p");
    spinner.textContent = "Searching flights...";
    document.body.appendChild(spinner);
    await deliverRecords();
    expect(sonifier.flushNow(10_000)).toBe("below-threshold");
  });
});

describe("which trigger owns a burst", () => {
  it("an index change with additions flushes immediately, carrying the points", async () => {
    sonifier = startMutationSonification();
    for (let i = 0; i < 5; i++) {
      document.body.appendChild(document.createElement("button"));
    }
    await deliverRecords();

    sonifier.onIndexChanged(
      changedEvent(["el_0", "el_1", "el_2"]),
      indexWith([
        { id: "el_0", x: 0.2, y: 0.3 },
        { id: "el_1", x: 0.5, y: 0.4 },
        { id: "el_2", x: 0.8, y: 0.5 },
      ])
    );

    // Without waiting out the churn debounce, the tones are already scheduled.
    const tones = getAudioLog().filter((c) => c.layer === "point");
    expect(tones).toHaveLength(3);
    // Panned left to right, because that is where they landed.
    expect(tones[0].pan).toBeLessThan(tones[2].pan);
  });

  it("an index change with no additions leaves the burst to the churn timer", async () => {
    sonifier = startMutationSonification();
    document.body.appendChild(document.createElement("div"));
    document.body.appendChild(document.createElement("div"));
    await deliverRecords();

    sonifier.onIndexChanged(changedEvent([]), indexWith([]));
    expect(getAudioLog()).toHaveLength(0);

    // ...and the timer still gets there on its own.
    await new Promise((resolve) => setTimeout(resolve, MUTATION_CHURN_DEBOUNCE_MS + 60));
    expect(getAudioLog().length).toBeGreaterThan(0);
  });

  it("the churn timer is a trailing throttle, so a page that never pauses still sounds", async () => {
    sonifier = startMutationSonification();
    // A resetting debounce would be starved forever by this.
    const interval = setInterval(() => {
      document.body.appendChild(document.createElement("div"));
      document.body.appendChild(document.createElement("div"));
    }, 20);
    await new Promise((resolve) => setTimeout(resolve, MUTATION_CHURN_DEBOUNCE_MS + 120));
    clearInterval(interval);
    expect(getAudioLog().length).toBeGreaterThan(0);
  });
});

describe("teardown", () => {
  it("disconnect stops counting and cancels a pending flush", async () => {
    sonifier = startMutationSonification();
    document.body.appendChild(document.createElement("div"));
    document.body.appendChild(document.createElement("div"));
    await deliverRecords();
    sonifier.disconnect();

    await new Promise((resolve) => setTimeout(resolve, MUTATION_CHURN_DEBOUNCE_MS + 60));
    expect(getAudioLog()).toHaveLength(0);

    document.body.appendChild(document.createElement("div"));
    await deliverRecords();
    expect(sonifier.flushNow(20_000)).toBe("below-threshold");
  });
});
