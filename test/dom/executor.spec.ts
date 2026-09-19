/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ElementIndex,
  type ElementIndexEntry,
  type ExecuteRequest,
} from "../../src/shared/contracts";
import { executeRequest } from "../../src/content/executor";
import { buildElementIndex } from "../../src/content/index-builder";
import { reResolveElement } from "../../src/content/reresolve";

describe("Action Executor DOM Tests (SPEC 7.6.3, 12.8, 12.10, 16 F-07)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    document.title = "Test Page";

    Object.defineProperty(document.documentElement, "scrollWidth", {
      value: 1000,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: 1000,
      configurable: true,
      writable: true,
    });

    Element.prototype.getBoundingClientRect = function () {
      return {
        width: 100,
        height: 30,
        top: 20,
        left: 50,
        right: 150,
        bottom: 50,
        x: 50,
        y: 20,
        toJSON: () => {},
      };
    };

    Element.prototype.scrollIntoView = vi.fn();
  });

  describe("Verb Execution & Event Dispatching", () => {
    it("click: triggers element.click() directly", async () => {
      const btn = document.createElement("button");
      btn.textContent = "Click Me";
      let clicked = false;
      btn.addEventListener("click", () => {
        clicked = true;
      });
      document.body.appendChild(btn);

      const index = buildElementIndex(document);
      const req: ExecuteRequest = {
        buildId: index.buildId,
        actions: [{ verb: "click", elementId: "el_0" }],
        stepDelayMs: 0,
        playTicks: false,
      };

      const result = await executeRequest(req, { doc: document, index });
      expect(result.ok).toBe(true);
      expect(result.completed).toBe(1);
      expect(clicked).toBe(true);
      expect(result.results[0].status).toBe("ok");
      expect(result.results[0].resolvedName).toBe("Click Me");
    });

    it("focus: focuses the element with preventScroll: true", async () => {
      const input = document.createElement("input");
      input.type = "text";
      input.setAttribute("aria-label", "Username");
      document.body.appendChild(input);

      const focusSpy = vi.spyOn(input, "focus");
      const index = buildElementIndex(document);
      const req: ExecuteRequest = {
        buildId: index.buildId,
        actions: [{ verb: "focus", elementId: "el_0" }],
        stepDelayMs: 0,
        playTicks: false,
      };

      const result = await executeRequest(req, { doc: document, index });
      expect(result.ok).toBe(true);
      expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
      expect(document.activeElement).toBe(input);
    });

    it("fill: sets .value and dispatches BOTH InputEvent('input') and Event('change') with bubbles: true", async () => {
      const form = document.createElement("form");
      const input = document.createElement("input");
      input.type = "text";
      input.setAttribute("aria-label", "City");
      form.appendChild(input);
      document.body.appendChild(form);

      let inputDispatched = false;
      let inputBubbled = false;
      let changeDispatched = false;
      let changeBubbled = false;
      let valueAtInput = "";
      let valueAtChange = "";

      input.addEventListener("input", (e) => {
        inputDispatched = true;
        valueAtInput = (e.target as HTMLInputElement).value;
      });

      form.addEventListener("input", (e) => {
        if (e.bubbles) inputBubbled = true;
      });

      input.addEventListener("change", (e) => {
        changeDispatched = true;
        valueAtChange = (e.target as HTMLInputElement).value;
      });

      form.addEventListener("change", (e) => {
        if (e.bubbles) changeBubbled = true;
      });

      const index = buildElementIndex(document);
      const req: ExecuteRequest = {
        buildId: index.buildId,
        actions: [{ verb: "fill", elementId: "el_0", value: "Waterloo" }],
        stepDelayMs: 0,
        playTicks: false,
      };

      const result = await executeRequest(req, { doc: document, index });
      expect(result.ok).toBe(true);
      expect(input.value).toBe("Waterloo");
      expect(inputDispatched).toBe(true);
      expect(inputBubbled).toBe(true);
      expect(valueAtInput).toBe("Waterloo");
      expect(changeDispatched).toBe(true);
      expect(changeBubbled).toBe(true);
      expect(valueAtChange).toBe("Waterloo");
    });

    it("fill: is noticed by a React-style value tracker (native prototype setter, not the tracked instance setter)", async () => {
      const container = document.createElement("div");
      const input = document.createElement("input");
      input.setAttribute("aria-label", "Controlled Input");
      container.appendChild(input);
      document.body.appendChild(container);

      // React installs an instance-level `value` property that records the last
      // value it saw. On an `input` event it fires onChange only if the node's
      // value differs from that record. Writing through the instance setter
      // updates the record, so the framework would drop the event.
      const nativeDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
      let tracked = "";
      const onChange = vi.fn();
      Object.defineProperty(input, "value", {
        configurable: true,
        get() {
          return nativeDescriptor.get!.call(this);
        },
        set(v: string) {
          tracked = String(v);
          nativeDescriptor.set!.call(this, v);
        },
      });
      input.addEventListener("input", () => {
        const now = String(nativeDescriptor.get!.call(input));
        if (now !== tracked) {
          tracked = now;
          onChange(now);
        }
      });

      const index = buildElementIndex(document);
      const req: ExecuteRequest = {
        buildId: index.buildId,
        actions: [{ verb: "fill", elementId: "el_0", value: "Framework State Test" }],
        stepDelayMs: 0,
        playTicks: false,
      };

      const result = await executeRequest(req, { doc: document, index });
      expect(result.ok).toBe(true);
      expect(nativeDescriptor.get!.call(input)).toBe("Framework State Test");
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("Framework State Test");
    });

    it("select: matches option text case-insensitively, updates selectedIndex, and dispatches change with bubbles: true", async () => {
      const select = document.createElement("select");
      select.setAttribute("aria-label", "Cabin Class");

      const opt1 = document.createElement("option");
      opt1.value = "eco";
      opt1.text = "Economy Class";
      select.appendChild(opt1);

      const opt2 = document.createElement("option");
      opt2.value = "biz";
      opt2.text = "Business Class";
      select.appendChild(opt2);

      const opt3 = document.createElement("option");
      opt3.value = "first";
      opt3.text = "First Class";
      select.appendChild(opt3);

      document.body.appendChild(select);

      let changeFired = false;
      let changeBubbled = false;
      select.addEventListener("change", () => {
        changeFired = true;
      });
      document.body.addEventListener("change", (e) => {
        if (e.bubbles) changeBubbled = true;
      });

      const index = buildElementIndex(document);
      const req: ExecuteRequest = {
        buildId: index.buildId,
        // Match option text case-insensitively: "business class"
        actions: [{ verb: "select", elementId: "el_0", value: "business class" }],
        stepDelayMs: 0,
        playTicks: false,
      };

      const result = await executeRequest(req, { doc: document, index });
      expect(result.ok).toBe(true);
      expect(select.selectedIndex).toBe(1);
      expect(select.value).toBe("biz");
      expect(changeFired).toBe(true);
      expect(changeBubbled).toBe(true);
    });

    it("select: returns not_found and aborts batch when option text does not match", async () => {
      const select = document.createElement("select");
      select.setAttribute("aria-label", "Class");
      const opt = document.createElement("option");
      opt.value = "eco";
      opt.text = "Economy";
      select.appendChild(opt);
      document.body.appendChild(select);

      const index = buildElementIndex(document);
      const req: ExecuteRequest = {
        buildId: index.buildId,
        actions: [{ verb: "select", elementId: "el_0", value: "NonExistentClass" }],
        stepDelayMs: 0,
        playTicks: false,
      };

      const result = await executeRequest(req, { doc: document, index });
      expect(result.ok).toBe(false);
      expect(result.completed).toBe(0);
      expect(result.failedAtIndex).toBe(0);
      expect(result.results[0].status).toBe("not_found");
    });

    it("check & uncheck: interacts with checkbox according to current checked state", async () => {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.setAttribute("aria-label", "Direct Flights Only");
      cb.checked = false;
      document.body.appendChild(cb);

      let clickCount = 0;
      cb.addEventListener("click", () => {
        clickCount++;
      });

      const index = buildElementIndex(document);

      // 1. check when unchecked -> clicks
      const checkReq: ExecuteRequest = {
        buildId: index.buildId,
        actions: [{ verb: "check", elementId: "el_0" }],
        stepDelayMs: 0,
        playTicks: false,
      };
      await executeRequest(checkReq, { doc: document, index });
      expect(clickCount).toBe(1);

      // Simulate checked state
      cb.checked = true;

      // 2. check when already checked -> does not click
      await executeRequest(checkReq, { doc: document, index });
      expect(clickCount).toBe(1);

      // 3. uncheck when checked -> clicks
      const uncheckReq: ExecuteRequest = {
        buildId: index.buildId,
        actions: [{ verb: "uncheck", elementId: "el_0" }],
        stepDelayMs: 0,
        playTicks: false,
      };
      await executeRequest(uncheckReq, { doc: document, index });
      expect(clickCount).toBe(2);

      // Simulate unchecked state
      cb.checked = false;

      // 4. uncheck when already unchecked -> does not click
      await executeRequest(uncheckReq, { doc: document, index });
      expect(clickCount).toBe(2);
    });

    it("scrollTo: calls scrollIntoView on element", async () => {
      const div = document.createElement("div");
      div.setAttribute("role", "button");
      div.setAttribute("tabindex", "0");
      div.setAttribute("aria-label", "Footer Action");
      document.body.appendChild(div);

      const scrollSpy = vi.spyOn(div, "scrollIntoView");
      const index = buildElementIndex(document);
      const req: ExecuteRequest = {
        buildId: index.buildId,
        actions: [{ verb: "scrollTo", elementId: "el_0" }],
        stepDelayMs: 0,
        playTicks: false,
      };

      const result = await executeRequest(req, { doc: document, index });
      expect(result.ok).toBe(true);
      expect(scrollSpy).toHaveBeenCalledWith({ block: "center", behavior: "instant" });
    });
  });

  describe("Immediate Re-resolution (SPEC 12.8)", () => {
    it("re-resolves a single matching element correctly", () => {
      const btn = document.createElement("button");
      btn.textContent = "Book Now";
      document.body.appendChild(btn);

      const index = buildElementIndex(document);
      const live = reResolveElement(index.entries[0], document);
      expect(live).toBe(btn);
    });

    it("disambiguates multiple matching elements using nearest document-relative center", () => {
      // Mock getBoundingClientRect on elements to simulate two identically named buttons at different positions
      const topBtn = document.createElement("button");
      topBtn.textContent = "Download PDF";
      topBtn.id = "top-download";
      document.body.appendChild(topBtn);

      const bottomBtn = document.createElement("button");
      bottomBtn.textContent = "Download PDF";
      bottomBtn.id = "bottom-download";
      document.body.appendChild(bottomBtn);

      vi.spyOn(topBtn, "getBoundingClientRect").mockReturnValue({
        left: 100,
        top: 50,
        right: 200,
        bottom: 90,
        width: 100,
        height: 40,
        x: 100,
        y: 50,
        toJSON: () => {},
      });

      vi.spyOn(bottomBtn, "getBoundingClientRect").mockReturnValue({
        left: 100,
        top: 700,
        right: 200,
        bottom: 740,
        width: 100,
        height: 40,
        x: 100,
        y: 700,
        toJSON: () => {},
      });

      const entryTop: ElementIndexEntry = {
        id: "el_0",
        role: "button",
        name: "Download PDF",
        nameKey: "download pdf",
        x: 0.15,
        y: 0.07,
        enabled: true,
        visible: true,
        inViewport: true,
        value: null,
        tag: "button",
        inputType: null,
        isPassword: false,
      };

      const entryBottom: ElementIndexEntry = {
        id: "el_1",
        role: "button",
        name: "Download PDF",
        nameKey: "download pdf",
        x: 0.15,
        y: 0.72,
        enabled: true,
        visible: true,
        inViewport: false,
        value: null,
        tag: "button",
        inputType: null,
        isPassword: false,
      };

      const resolvedTop = reResolveElement(entryTop, document);
      expect(resolvedTop).toBe(topBtn);

      const resolvedBottom = reResolveElement(entryBottom, document);
      expect(resolvedBottom).toBe(bottomBtn);
    });

    it("treats a lone match that moved > 0.15 normalized units as not_found (SPEC 12.10), and accepts small drift", () => {
      const btn = document.createElement("button");
      btn.textContent = "Confirm";
      document.body.appendChild(btn);

      const rect = (left: number, top: number) => ({
        left,
        top,
        right: left + 100,
        bottom: top + 30,
        width: 100,
        height: 30,
        x: left,
        y: top,
        toJSON: () => {},
      });
      // Indexed at the centre (0.5, 0.5) of the mocked 1000 x 1000 document.
      const spy = vi.spyOn(btn, "getBoundingClientRect").mockReturnValue(rect(450, 485));

      const entry: ElementIndexEntry = {
        id: "el_0",
        role: "button",
        name: "Confirm",
        nameKey: "confirm",
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

      expect(reResolveElement(entry, document)).toBe(btn); // unmoved
      spy.mockReturnValue(rect(470, 505)); // drifted 20px: well inside 0.15
      expect(reResolveElement(entry, document)).toBe(btn);
      spy.mockReturnValue(rect(50, 50)); // jumped to the corner: 0.6 units away
      expect(reResolveElement(entry, document)).toBeNull();
    });

    it("treats element as not_found if nearest match is > 0.15 normalized units away (SPEC 12.8 rule 4, 12.10)", () => {
      const btn1 = document.createElement("button");
      btn1.textContent = "Save";
      document.body.appendChild(btn1);

      const btn2 = document.createElement("button");
      btn2.textContent = "Save";
      document.body.appendChild(btn2);

      // Both buttons far away from (0.05, 0.05)
      vi.spyOn(btn1, "getBoundingClientRect").mockReturnValue({
        left: 500,
        top: 500,
        right: 600,
        bottom: 550,
        width: 100,
        height: 50,
        x: 500,
        y: 500,
        toJSON: () => {},
      });
      vi.spyOn(btn2, "getBoundingClientRect").mockReturnValue({
        left: 800,
        top: 800,
        right: 900,
        bottom: 850,
        width: 100,
        height: 50,
        x: 800,
        y: 800,
        toJSON: () => {},
      });

      const entryFar: ElementIndexEntry = {
        id: "el_0",
        role: "button",
        name: "Save",
        nameKey: "save",
        x: 0.05,
        y: 0.05,
        enabled: true,
        visible: true,
        inViewport: true,
        value: null,
        tag: "button",
        inputType: null,
        isPassword: false,
      };

      const result = reResolveElement(entryFar, document);
      expect(result).toBeNull();
    });

    it("returns not_found when element was removed between resolve and execute", async () => {
      const btn = document.createElement("button");
      btn.textContent = "Temporary Button";
      document.body.appendChild(btn);

      const index = buildElementIndex(document);

      // Remove element before execution
      document.body.removeChild(btn);

      const req: ExecuteRequest = {
        buildId: index.buildId,
        actions: [{ verb: "click", elementId: "el_0" }],
        stepDelayMs: 0,
        playTicks: false,
      };

      const result = await executeRequest(req, { doc: document, index });
      expect(result.ok).toBe(false);
      expect(result.completed).toBe(0);
      expect(result.failedAtIndex).toBe(0);
      expect(result.results[0].status).toBe("not_found");
    });
  });

  describe("Non-Actionable & Security Validations (§7.6.3 step 2, R2.4)", () => {
    it("aborts batch with not_actionable if element became disabled", async () => {
      const btn = document.createElement("button");
      btn.textContent = "Submit Form";
      document.body.appendChild(btn);

      const index = buildElementIndex(document);

      // Disable button before execution
      btn.setAttribute("disabled", "true");

      const req: ExecuteRequest = {
        buildId: index.buildId,
        actions: [{ verb: "click", elementId: "el_0" }],
        stepDelayMs: 0,
        playTicks: false,
      };

      const result = await executeRequest(req, { doc: document, index });
      expect(result.ok).toBe(false);
      expect(result.completed).toBe(0);
      expect(result.failedAtIndex).toBe(0);
      expect(result.results[0].status).toBe("not_actionable");
      expect(result.results[0].detail).toContain("disabled");
    });

    it("aborts batch with not_actionable if element became hidden", async () => {
      const btn = document.createElement("button");
      btn.textContent = "Hidden Action";
      document.body.appendChild(btn);

      const index = buildElementIndex(document);

      // Hide button
      btn.style.display = "none";

      const req: ExecuteRequest = {
        buildId: index.buildId,
        actions: [{ verb: "click", elementId: "el_0" }],
        stepDelayMs: 0,
        playTicks: false,
      };

      const result = await executeRequest(req, { doc: document, index });
      expect(result.ok).toBe(false);
      expect(result.completed).toBe(0);
      expect(result.results[0].status).toBe("not_actionable");
    });

    it("aborts batch with not_actionable if target element is a password input (R2.4)", async () => {
      const input = document.createElement("input");
      input.setAttribute("role", "textbox");
      input.type = "password";
      input.setAttribute("aria-label", "Password Input");
      document.body.appendChild(input);

      // Force mock entry to test executor gate
      const entry: ElementIndexEntry = {
        id: "el_0",
        role: "textbox",
        name: "Password Input",
        nameKey: "password input",
        x: 0.1,
        y: 0.035,
        enabled: true,
        visible: true,
        inViewport: true,
        value: null,
        tag: "input",
        inputType: "password",
        isPassword: true,
      };

      const index: ElementIndex = {
        buildId: "test-pw-build",
        url: "http://localhost",
        title: "Test",
        builtAt: 1,
        viewportW: 1024,
        viewportH: 768,
        docH: 768,
        entries: [entry],
        truncated: false,
      };

      const req: ExecuteRequest = {
        buildId: index.buildId,
        actions: [{ verb: "fill", elementId: "el_0", value: "SecretPass123" }],
        stepDelayMs: 0,
        playTicks: false,
      };

      const result = await executeRequest(req, { doc: document, index });
      expect(result.ok).toBe(false);
      expect(result.results[0].status).toBe("not_actionable");
      expect(result.results[0].detail).toContain("password");
    });
  });

  describe("BuildId Verification & Multi-Action Sequences", () => {
    it("rejects batch when buildId does not match current index buildId (SPEC 12.10, 16 F-07)", async () => {
      const btn = document.createElement("button");
      btn.textContent = "Action Button";
      document.body.appendChild(btn);

      const index = buildElementIndex(document);

      const req: ExecuteRequest = {
        buildId: "stale-build-id-12345",
        actions: [{ verb: "click", elementId: "el_0" }],
        stepDelayMs: 0,
        playTicks: false,
      };

      const result = await executeRequest(req, { doc: document, index });
      expect(result.ok).toBe(false);
      expect(result.completed).toBe(0);
      expect(result.failedAtIndex).toBe(0);
      expect(result.results[0].status).toBe("rejected");
      expect(result.results[0].detail).toContain("buildId mismatch");
    });

    it("executes multi-action sequence in order and applies highlight", async () => {
      const input = document.createElement("input");
      input.type = "text";
      input.setAttribute("aria-label", "Departure");
      document.body.appendChild(input);

      const btn = document.createElement("button");
      btn.textContent = "Search Flights";
      let btnClicked = false;
      btn.addEventListener("click", () => {
        btnClicked = true;
      });
      document.body.appendChild(btn);

      const index = buildElementIndex(document);
      const req: ExecuteRequest = {
        buildId: index.buildId,
        actions: [
          { verb: "fill", elementId: "el_0", value: "Montreal" },
          { verb: "click", elementId: "el_1" },
        ],
        stepDelayMs: 10,
        playTicks: false,
      };

      const result = await executeRequest(req, { doc: document, index });
      expect(result.ok).toBe(true);
      expect(result.completed).toBe(2);
      expect(input.value).toBe("Montreal");
      expect(btnClicked).toBe(true);
      expect(result.results[0].status).toBe("ok");
      expect(result.results[1].status).toBe("ok");

      // Verify highlight class was applied
      expect(btn.classList.contains("echo-highlight")).toBe(true);
    });

    it("stops immediately and aborts remaining actions when an intermediate step fails", async () => {
      const input = document.createElement("input");
      input.type = "text";
      input.setAttribute("aria-label", "Destination");
      document.body.appendChild(input);

      const btn1 = document.createElement("button");
      btn1.textContent = "Disabled Action";
      btn1.setAttribute("disabled", "true");
      document.body.appendChild(btn1);

      const btn2 = document.createElement("button");
      btn2.textContent = "Should Not Execute";
      let btn2Clicked = false;
      btn2.addEventListener("click", () => {
        btn2Clicked = true;
      });
      document.body.appendChild(btn2);

      // Build index manually to include el_0, el_1, el_2
      const index: ElementIndex = {
        buildId: "test-multi-fail",
        url: "http://localhost",
        title: "Test",
        builtAt: 1,
        viewportW: 1024,
        viewportH: 768,
        docH: 768,
        entries: [
          {
            id: "el_0",
            role: "textbox",
            name: "Destination",
            nameKey: "destination",
            x: 0.1,
            y: 0.035,
            enabled: true,
            visible: true,
            inViewport: true,
            value: null,
            tag: "input",
            inputType: "text",
            isPassword: false,
          },
          {
            id: "el_1",
            role: "button",
            name: "Disabled Action",
            nameKey: "disabled action",
            x: 0.1,
            y: 0.035,
            enabled: true, // was marked enabled at build time, but is disabled live
            visible: true,
            inViewport: true,
            value: null,
            tag: "button",
            inputType: null,
            isPassword: false,
          },
          {
            id: "el_2",
            role: "button",
            name: "Should Not Execute",
            nameKey: "should not execute",
            x: 0.1,
            y: 0.035,
            enabled: true,
            visible: true,
            inViewport: true,
            value: null,
            tag: "button",
            inputType: null,
            isPassword: false,
          },
        ],
        truncated: false,
      };

      const req: ExecuteRequest = {
        buildId: index.buildId,
        actions: [
          { verb: "fill", elementId: "el_0", value: "Vancouver" },
          { verb: "click", elementId: "el_1" }, // Fails because button has disabled attribute live
          { verb: "click", elementId: "el_2" }, // Must NOT execute
        ],
        stepDelayMs: 10,
        playTicks: false,
      };

      const result = await executeRequest(req, { doc: document, index });
      expect(result.ok).toBe(false);
      expect(result.completed).toBe(1); // Step 0 completed
      expect(result.failedAtIndex).toBe(1); // Step 1 failed
      expect(result.results.length).toBe(2);
      expect(result.results[0].status).toBe("ok");
      expect(result.results[1].status).toBe("not_actionable");
      expect(input.value).toBe("Vancouver");
      expect(btn2Clicked).toBe(false); // Step 2 was never executed
    });
  });
});
