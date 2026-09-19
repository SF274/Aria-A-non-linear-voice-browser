import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  computeIndexDiff,
  createIndexObserver,
  INITIAL_DEBOUNCE_MS,
  RUNAWAY_DEBOUNCE_MS,
} from "../../src/content/observer";
import { type ElementIndexEntry, type MutationEvent } from "../../src/shared/contracts";

describe("Mutation Observer & Index Invalidation (SPEC 12.9)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";

    Element.prototype.getBoundingClientRect = function () {
      return {
        width: 100,
        height: 30,
        top: 10,
        left: 10,
        right: 110,
        bottom: 40,
        x: 10,
        y: 10,
        toJSON: () => {},
      };
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("computeIndexDiff", () => {
    it("computes addedIds and removedIds based on (role, nameKey) matching", () => {
      const entry1: ElementIndexEntry = {
        id: "el_0",
        role: "link",
        name: "Home",
        nameKey: "home",
        x: 0.1,
        y: 0.1,
        enabled: true,
        visible: true,
        inViewport: true,
        value: null,
        tag: "a",
        inputType: null,
        isPassword: false,
      };

      const entry2: ElementIndexEntry = {
        id: "el_1",
        role: "button",
        name: "Search flights",
        nameKey: "search flights",
        x: 0.5,
        y: 0.5,
        enabled: true,
        visible: true,
        inViewport: true,
        value: null,
        tag: "button",
        inputType: null,
        isPassword: false,
      };

      const entry3New: ElementIndexEntry = {
        id: "el_2",
        role: "button",
        name: "Confirm booking",
        nameKey: "confirm booking",
        x: 0.8,
        y: 0.8,
        enabled: true,
        visible: true,
        inViewport: true,
        value: null,
        tag: "button",
        inputType: null,
        isPassword: false,
      };

      // 1. Initial addition: prev has entry1, new has entry1 and entry2
      const diff1 = computeIndexDiff([entry1], [entry1, entry2]);
      expect(diff1.addedIds).toEqual(["el_1"]);
      expect(diff1.removedIds).toEqual([]);

      // 2. Removal: prev has entry1 and entry2, new has only entry1
      const diff2 = computeIndexDiff([entry1, entry2], [entry1]);
      expect(diff2.addedIds).toEqual([]);
      expect(diff2.removedIds).toEqual(["el_1"]);

      // 3. Replacement: prev has entry2, new has entry3New
      const diff3 = computeIndexDiff([entry2], [entry3New]);
      expect(diff3.addedIds).toEqual(["el_2"]);
      expect(diff3.removedIds).toEqual(["el_1"]);

      // 4. Identical
      const diff4 = computeIndexDiff([entry1, entry2], [entry1, entry2]);
      expect(diff4.addedIds).toEqual([]);
      expect(diff4.removedIds).toEqual([]);
    });
  });

  describe("createIndexObserver", () => {
    it("debounces rebuilds by 150 ms", async () => {
      document.body.innerHTML = `
        <button id="btn1">Button 1</button>
      `;

      let changeCallCount = 0;
      let lastEvent: MutationEvent | null = null;

      const observerHandle = createIndexObserver({
        doc: document,
        onIndexChanged: (event) => {
          changeCallCount++;
          lastEvent = event;
        },
      });

      expect(observerHandle.getDebounceMs()).toBe(INITIAL_DEBOUNCE_MS);
      expect(observerHandle.getCurrentIndex().entries.length).toBe(1);

      // Trigger mutation by appending a button
      const newBtn = document.createElement("button");
      newBtn.textContent = "Button 2";
      document.body.appendChild(newBtn);

      // Wait 50 ms (less than 150 ms debounce)
      await vi.advanceTimersByTimeAsync(50);
      expect(changeCallCount).toBe(0);

      // Advance past 150 ms debounce (total 150 ms)
      await vi.advanceTimersByTimeAsync(110);

      expect(changeCallCount).toBe(1);
      expect(lastEvent).not.toBeNull();
      expect(lastEvent!.addedIds.length).toBe(1);
      expect(observerHandle.getCurrentIndex().entries.length).toBe(2);

      observerHandle.disconnect();
    });

    it("ignores mutations originating inside [data-echo]", async () => {
      document.body.innerHTML = `
        <div data-echo="blackout">
          <button id="overlay-btn">Overlay</button>
        </div>
        <button id="page-btn">Page</button>
      `;

      let changeCallCount = 0;
      const observerHandle = createIndexObserver({
        doc: document,
        onIndexChanged: () => {
          changeCallCount++;
        },
      });

      // Mutate inside [data-echo]
      const overlay = document.querySelector("[data-echo]")!;
      const innerSpan = document.createElement("span");
      innerSpan.textContent = "Noise";
      overlay.appendChild(innerSpan);

      await vi.advanceTimersByTimeAsync(200);
      expect(changeCallCount).toBe(0);

      observerHandle.disconnect();
    });

    it("triggers runaway guard if rebuilds exceed 5/s for 3 consecutive seconds", () => {
      document.body.innerHTML = `<button>Button</button>`;

      const observerHandle = createIndexObserver({
        doc: document,
      });

      expect(observerHandle.getDebounceMs()).toBe(INITIAL_DEBOUNCE_MS);

      // Simulate 6 rebuilds in second 1, 6 in second 2, 6 in second 3
      // Second 1 (t = 1000)
      vi.setSystemTime(1000);
      for (let i = 0; i < 6; i++) observerHandle.rebuildNow();

      // Second 2 (t = 2000)
      vi.setSystemTime(2000);
      for (let i = 0; i < 6; i++) observerHandle.rebuildNow();

      // Second 3 (t = 3000)
      vi.setSystemTime(3000);
      for (let i = 0; i < 6; i++) observerHandle.rebuildNow();

      expect(observerHandle.getDebounceMs()).toBe(RUNAWAY_DEBOUNCE_MS);

      observerHandle.disconnect();
    });
  });
});
