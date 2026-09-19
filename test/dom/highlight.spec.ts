import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHighlights,
  highlightCandidates,
  highlightElement,
  injectHighlightStyles,
  OVERLAY_CSS,
} from "../../src/content/highlight";

describe("Visual Highlight Overlay (SPEC 6.11, 9.9, 16 F-09)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.head.innerHTML = "";
    document.body.innerHTML = `
      <div id="container">
        <button id="btn1" style="color: red; padding: 8px 16px; margin: 4px;">Search</button>
        <button id="btn2" style="background-color: blue; border-radius: 4px;">Submit</button>
        <input id="input1" type="text" style="border: 1px solid black;">
      </div>
    `;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    clearHighlights(document);
  });

  it("injects the highlight stylesheet with [data-echo='highlight-styles'] exactly once", () => {
    const style1 = injectHighlightStyles(document);
    expect(style1).toBeDefined();
    expect(document.head.querySelectorAll("style[data-echo='highlight-styles']")).toHaveLength(1);

    // Repeated call should return existing style element without creating duplicates
    const style2 = injectHighlightStyles(document);
    expect(style2).toBe(style1);
    expect(document.head.querySelectorAll("style[data-echo='highlight-styles']")).toHaveLength(1);

    expect(style1.textContent).toContain(".echo-highlight");
    expect(style1.textContent).toContain(".echo-candidate");
    expect(style1.textContent).toContain("#FFB020");
    expect(style1.textContent).toContain("#3B82F6");
  });

  it("applies .echo-highlight for 400 ms and removes it afterwards (F-09)", () => {
    const btn = document.getElementById("btn1")!;
    expect(btn.classList.contains("echo-highlight")).toBe(false);

    highlightElement(btn, 400);
    expect(btn.classList.contains("echo-highlight")).toBe(true);

    // At 399 ms, highlight is still present
    vi.advanceTimersByTime(399);
    expect(btn.classList.contains("echo-highlight")).toBe(true);

    // At 400 ms, highlight is removed
    vi.advanceTimersByTime(1);
    expect(btn.classList.contains("echo-highlight")).toBe(false);
  });

  it("guarantees the page's own inline styles are byte-identical before, during, and after (F-09)", () => {
    const btn = document.getElementById("btn1")!;
    const originalStyle = btn.getAttribute("style");
    expect(originalStyle).not.toBeNull();

    highlightElement(btn, 400);

    // During highlight: inline styles must be byte-identical
    const duringStyle = btn.getAttribute("style");
    expect(duringStyle).toBe(originalStyle);

    // Advance timer to complete highlight
    vi.advanceTimersByTime(400);

    // After highlight: inline styles must still be byte-identical
    const afterStyle = btn.getAttribute("style");
    expect(afterStyle).toBe(originalStyle);
  });

  it("supports early cleanup via returned cleanup function", () => {
    const btn = document.getElementById("btn1")!;
    const cleanup = highlightElement(btn, 400);
    expect(btn.classList.contains("echo-highlight")).toBe(true);

    cleanup();
    expect(btn.classList.contains("echo-highlight")).toBe(false);

    // Advancing timers should not cause errors
    vi.advanceTimersByTime(500);
    expect(btn.classList.contains("echo-highlight")).toBe(false);
  });

  it("highlights multiple candidates with .echo-highlight and .echo-candidate (SPEC 7.5.1)", () => {
    const btn1 = document.getElementById("btn1")!;
    const btn2 = document.getElementById("btn2")!;

    const cleanup = highlightCandidates([btn1, btn2]);
    expect(btn1.classList.contains("echo-highlight")).toBe(true);
    expect(btn1.classList.contains("echo-candidate")).toBe(true);
    expect(btn2.classList.contains("echo-highlight")).toBe(true);
    expect(btn2.classList.contains("echo-candidate")).toBe(true);

    cleanup();
    expect(btn1.classList.contains("echo-highlight")).toBe(false);
    expect(btn1.classList.contains("echo-candidate")).toBe(false);
    expect(btn2.classList.contains("echo-highlight")).toBe(false);
    expect(btn2.classList.contains("echo-candidate")).toBe(false);
  });

  it("clears all highlights and candidate classes across document on transition to IDLE (SPEC 9.9)", () => {
    const btn1 = document.getElementById("btn1")!;
    const btn2 = document.getElementById("btn2")!;
    const input1 = document.getElementById("input1")!;

    highlightElement(btn1, 400);
    highlightCandidates([btn2, input1]);

    expect(btn1.classList.contains("echo-highlight")).toBe(true);
    expect(btn2.classList.contains("echo-candidate")).toBe(true);
    expect(input1.classList.contains("echo-candidate")).toBe(true);

    clearHighlights(document);

    expect(btn1.classList.contains("echo-highlight")).toBe(false);
    expect(btn2.classList.contains("echo-highlight")).toBe(false);
    expect(btn2.classList.contains("echo-candidate")).toBe(false);
    expect(input1.classList.contains("echo-highlight")).toBe(false);
    expect(input1.classList.contains("echo-candidate")).toBe(false);

    // Verify timers were cancelled so no delayed class removal throws
    vi.advanceTimersByTime(1000);
  });

  it("OVERLAY_CSS matches SPEC 9.9 definitions exactly", () => {
    expect(OVERLAY_CSS).toContain("outline: 3px solid #FFB020 !important;");
    expect(OVERLAY_CSS).toContain("outline-offset: 2px !important;");
    expect(OVERLAY_CSS).toContain("box-shadow: 0 0 0 6px rgba(255, 176, 32, 0.25) !important;");
    expect(OVERLAY_CSS).toContain("transition: none !important;");
    expect(OVERLAY_CSS).toContain(".echo-candidate {");
    expect(OVERLAY_CSS).toContain("outline-color: #3B82F6 !important;");
  });
});
