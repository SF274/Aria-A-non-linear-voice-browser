import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // jsdom covers both test/unit (pure logic, jsdom globals unused but
    // harmless) and test/dom (SPEC 17.1 requires jsdom) without needing
    // per-directory environment switching.
    environment: "jsdom",
    include: [
      "test/unit/**/*.spec.ts",
      "test/dom/**/*.spec.ts",
      "test/perf/**/*.spec.ts",
    ],
    passWithNoTests: false,
  },
});
