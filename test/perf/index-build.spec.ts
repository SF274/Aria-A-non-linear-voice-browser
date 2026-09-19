import { beforeEach, describe, expect, it } from "vitest";

import { buildElementIndex } from "../../src/content/index-builder";
import { MAX_INDEX } from "../../src/shared/constants";

describe("Index Build Performance Gate IG-05 (SPEC 6.5, 12.2, 18)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.title = "Performance Test 120 Elements";

    Element.prototype.getBoundingClientRect = function () {
      return {
        width: 120,
        height: 35,
        top: 50,
        left: 50,
        right: 170,
        bottom: 85,
        x: 50,
        y: 50,
        toJSON: () => {},
      };
    };
  });

  it("builds a 120-element index in under 120 ms and serializes under 24 KB (IG-05)", () => {
    // Generate 120 representative interactive elements (links, buttons, inputs, checkboxes)
    const elementTypes = [
      (i: number) => `<button id="btn_${i}">Button ${i}</button>`,
      (i: number) => `<a href="#link_${i}">Link ${i}</a>`,
      (i: number) => `<button id="act_${i}">Action ${i}</button>`,
      (i: number) => `<input type="text" id="inp_${i}" placeholder="Field ${i}" />`,
      (i: number) => `<a href="#nav_${i}">Nav ${i}</a>`,
      (i: number) =>
        `<input type="checkbox" id="chk_${i}" /><label for="chk_${i}">Option ${i}</label>`,
    ];

    let html = "";
    for (let i = 0; i < MAX_INDEX; i++) {
      const generator = elementTypes[i % elementTypes.length];
      html += generator(i) + "\n";
    }
    document.body.innerHTML = html;

    // Warm-up run
    buildElementIndex(document);

    // Timed run (best of 5 runs to absorb single-iteration GC/OS scheduling pauses)
    let duration = Infinity;
    let index = buildElementIndex(document);
    for (let r = 0; r < 5; r++) {
      const start = performance.now();
      const candidate = buildElementIndex(document);
      const elapsed = performance.now() - start;
      if (elapsed < duration) {
        duration = elapsed;
        index = candidate;
      }
    }

    console.log(`[PERF IG-05] Index build for 120 elements took: ${duration.toFixed(2)} ms`);

    expect(index.entries.length).toBe(MAX_INDEX);
    expect(index.truncated).toBe(false);

    // IG-05 Gate: under 120 ms
    expect(duration).toBeLessThan(120);

    // SPEC 5.2 / F-04: Serialized size under 24 KB (24,576 bytes)
    const serialized = JSON.stringify(index);
    const byteSize = new TextEncoder().encode(serialized).length;
    console.log(`[PERF F-04] Serialized index size: ${(byteSize / 1024).toFixed(2)} KB (${byteSize} bytes)`);
    expect(byteSize).toBeLessThan(24 * 1024);
  });
});
