/**
 * Execution and transport ticks — the rule that audio trouble never breaks
 * anything (SPEC 9.6).
 *
 * The SPEC 9.3 mapping table these ticks are built on is asserted in
 * `audio.spec.ts`, which owns the engine.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAudioEngine } from "../../src/content/audio/engine";
import {
  playError,
  playListenEnd,
  playListenStart,
  playPositionalTick,
  playProcessingTick,
} from "../../src/content/audio/transport";

describe("cues degrade to silence (SPEC 9.6)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetAudioEngine();
  });

  it("never throw when an AudioContext cannot be constructed", async () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("no audio device");
        }
      }
    );
    await expect(playPositionalTick({ x: 0.2, y: 0.8, role: "button" })).resolves.toBeUndefined();
    await expect(playProcessingTick()).resolves.toBeUndefined();
    await expect(playListenStart()).resolves.toBeUndefined();
    await expect(playListenEnd()).resolves.toBeUndefined();
    await expect(playError()).resolves.toBeUndefined();
  });

  it("never throw when there is no AudioContext at all (jsdom)", async () => {
    // jsdom has no Web Audio. This is the path a unit test run takes, and it
    // must be the quiet one rather than the one that fails a command.
    await expect(playPositionalTick({ x: 0.5, y: 0.5, role: "link" })).resolves.toBeUndefined();
    await expect(playProcessingTick()).resolves.toBeUndefined();
  });

  it("never throw when a suspended context refuses to resume", async () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        state = "suspended";
        resume() {
          return Promise.reject(new Error("blocked by autoplay policy"));
        }
      }
    );
    await expect(playListenStart()).resolves.toBeUndefined();
    await expect(playPositionalTick({ x: 0.1, y: 0.1, role: "textbox" })).resolves.toBeUndefined();
  });
});
