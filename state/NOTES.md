# state/NOTES.md

**Authority: rank 7, lowest.** Nothing here is binding. Never resolve a conflict using this file.

**Purpose:** observations that would otherwise be rediscovered. Write for a future session that has never seen this repository, because that reader is you with no memory of today.

Good entries: a package that behaves unexpectedly, a Chrome quirk observed on this machine, a test that is flaky and why, a measurement worth keeping, the reason a file is organized unusually.

Bad entries: anything that belongs in `DECISIONS.md` (a choice), `ERRORS.md` (a failure), `DEVIATIONS.md` (a departure from SPEC), or `HUMAN_DECISIONS.md` (a question).

Format:

```
### N-00n — <one line>
- **Date:**
- **Context:**
- **Observation:**
- **Relevance:** what a future session should do with this
```

---

## Session boundary protocol

At the end of every working session, before context is lost, write here anything a fresh session would otherwise spend time rediscovering. Specifically:

- Measurements taken (index build times, latency numbers, hit rates).
- Test flakiness and its cause.
- Anything about this specific machine or Chrome profile.
- Partial work in progress and where it stands.

---

## Notes

### N-001 — F-01's SPEC 16 criteria span three tasks, not just T0-01
- **Date:** 2026-09-19
- **Context:** TASKS.md gives T0-01, T0-03, and (for the manifest-matches-8.7 clause) implicitly T0-18 each a "Done when: F-01 criteria in SPEC 16 pass" line, but F-01's actual criteria (SPEC 16) require a content script that "injects into the demo page and logs a single readiness line" and "at least one contract test" — neither exists after T0-01 alone. T0-01's own concrete deliverable is its named Tests field: `test/unit/smoke.spec.ts` plus a green `pnpm verify`.
- **Observation:** T0-01 is marked `DONE` in `state/STATUS.md` on the strength of its own Build/Tests fields (build pipeline works, smoke test passes, `pnpm verify` exits 0), not on the strength of F-01's full SPEC 16 criteria. Those become fully checkable once T0-02 (contract test) and T0-03 (manifest matching 8.7 exactly, content script readiness log) land.
- **Relevance:** when T0-03 finishes, re-check F-01's SPEC 16 criteria in full before treating the feature (not just the task) as closed. Do not read T0-01's `DONE` state as a claim that F-01 is fully verified.

### N-002 — Root `manifest.json` is a placeholder until T0-03
- **Date:** 2026-09-19
- **Context:** the build pipeline (T0-01) needs a real `manifest.json` at the repo root to copy into `dist/` for `test/unit/smoke.spec.ts` to pass. T0-01's own component list (root, `vite.config.ts`, `package.json`, `tsconfig.json`) does not name `manifest.json`; TASKS.md assigns it to T0-03.
- **Observation:** created `manifest.json` now with only `manifest_version`, `name`, `version`, `description` — no `permissions`, no `host_permissions`, no entry points. T0-03 is the task that must add the exact SPEC 8.7 permission set, service worker, and content script registration, and its own test (`test/unit/manifest.spec.ts`) is what actually gates permission correctness.
- **Relevance:** when starting T0-03, edit this file in place rather than treating its existence as already satisfying any part of T0-03's scope.

### N-003 — `pnpm verify` runs `pnpm build` first
- **Date:** 2026-09-19
- **Context:** SPEC 17.1 lists `pnpm verify`'s phases as "typecheck, lint, unit, dom, and e2e" without mentioning build, but the e2e layer (SPEC 17.2) loads `dist/` as an unpacked extension and T0-01's own smoke test asserts `dist/manifest.json` exists.
- **Observation:** `package.json`'s `verify` script is `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run test:e2e` — build runs first as an implicit prerequisite stage, not one of the five gating phases SPEC 17.1 names.
- **Relevance:** this is not a SPEC deviation (SPEC does not forbid a build step ahead of the five phases), so no `DEVIATIONS.md` entry was written. A future session extending `verify` should keep `build` first.

### N-004 — pnpm via corepack failed; installed globally with npm instead
- **Date:** 2026-09-19
- **Context:** `corepack prepare pnpm@9 --activate` failed with `EPERM: operation not permitted, open 'C:\Program Files\nodejs\pnpm'` on this machine (Windows, non-elevated shell).
- **Observation:** `npm install -g pnpm` succeeded and installed pnpm 12.4.2, which satisfies the "pnpm 9" minimum in `state/ENVIRONMENT.md`. `pnpm install` also auto-created `pnpm-workspace.yaml` with a `minimumReleaseAgeExclude` block (a pnpm 12 supply-chain feature); this is normal pnpm 12 behavior, not something added by hand.
- **Relevance:** if a fresh session on this same machine hits the same corepack `EPERM`, skip straight to `npm install -g pnpm` rather than re-attempting corepack (would count as the same fix attempt under R5.3 anyway).

### N-005 — `ResolverResponseSchema` deliberately does not range-check `confidence` or pattern-check `elementId`
- **Date:** 2026-09-19
- **Context:** `src/shared/contracts.ts`'s `ResolverResponseSchema` (SPEC 5.5) validates the shape of a parsed Gemini response, but leaves `confidence` as a bare `z.number()` (no `.min(0).max(1)`) and `elementId` as a bare `z.string()` (no `ELEMENT_ID_PATTERN`).
- **Observation:** this is intentional, not an oversight. SPEC 11.4 rule 5 requires an out-of-range `confidence` to be *clamped and penalised by 0.1* downstream, not rejected at the schema boundary; rule 3 requires an `elementId` not present in the live index to be treated as a *miss*, which requires cross-referencing the current `ElementIndex` — something `contracts.ts` has no access to and shouldn't. If the schema rejected either case outright, SPEC 11.4 rules 3 and 5 would become unreachable dead code.
- **Relevance:** whoever implements T0-13 (Gemini client) and T0-14 (action validation) should apply `ResolverResponseSchema` first for shape validation, then apply the SPEC 11.4 rule 5 clamp/penalty logic, then separately validate each `elementId` against the live index per SPEC 7.6.1 rule 3 (that membership check belongs in `src/sw/execute/validate.ts`, not in the shared contract).

### N-006 — SPEC 9.3 gives no base peak gain for the "Other" audio role class
- **Date:** 2026-09-19
- **Context:** SPEC 9.3's "Timbre by role class" table gives explicit peak gains for navigational (0.16), control (0.18), and input (0.14), but the "Other" row says only "gain × 0.7" with no base value to multiply.
- **Observation:** `src/shared/constants.ts`'s `ROLE_CLASS_TIMBRE.other` encodes exactly what SPEC states — `{ oscillator: "sine", gainMultiplier: 0.7 }` — with no `peakGain` field, rather than inventing a number SPEC doesn't give.
- **Relevance:** whoever implements T1-02 (audio engine, F-10) will need an actual gain value for the "Other" class and will hit this gap directly. This is a genuine SPEC gap worth a `state/HUMAN_DECISIONS.md` question if a real "Other"-class element turns up in testing (most indexed elements fall into navigational/control/input per SPEC 12.2's selector union, so this may never actually fire — worth checking before escalating).

### N-007 — Added `@axe-core/playwright` devDependency for T0-04 a11y testing
- **Date:** 2026-09-19
- **Context:** `TASKS.md` T0-04 and SPEC 17.1 specify `test/e2e/demo-a11y.spec.ts` using axe-core to assert zero serious or critical accessibility violations on the demo page fixture. Neither `axe-core` nor `@axe-core/playwright` was in `package.json` after scaffolding (T0-01).
- **Observation:** `pnpm add -D @axe-core/playwright` was run and recorded under `D-012` in `state/DECISIONS.md` per `AGENT_RULES.md` R1.4. This edits `package.json` (devDependency only).
- **Relevance:** `test/e2e/demo-a11y.spec.ts` now uses `import AxeBuilder from "@axe-core/playwright"` natively without external network calls during tests.

### N-008 — Root build-tooling files aren't assigned to either agent in AGENT_SPLIT.md section 6, and both agents share one working directory
- **Date:** 2026-09-19
- **Context:** while implementing T0-03, `package.json` (needed a new `tsx` devDependency to fix a real build bug — see below) was observed changing on disk mid-edit: gemini had concurrently added `@axe-core/playwright` for T0-04, uncommitted, in the same working tree. `AGENT_SPLIT.md` section 6 lists per-agent ownership for feature files (`src/**`, `demo/**`, `test/e2e/**` by area) but names neither agent as owner of `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `vitest.config.ts`, or `playwright.config.ts` — all created under T0-01 (solo, claude), but section 6's table (written for T1+ ownership going forward) doesn't re-list them. `ListAgents` shows no reachable peer session, so there is no live channel to coordinate with gemini directly; the only coordination surface is the filesystem/git protocol in section 4.
- **Observation:** both agents legitimately need to touch these shared config files (independent devDependency additions, at minimum) and are editing the same on-disk checkout concurrently, not separate clones synced only through git. A `Write` (full overwrite) on any of these files risks silently discarding the other agent's uncommitted change; a targeted `Edit` (old_string/new_string) is safe only if it doesn't touch the same lines. This session's `tsx` addition to `package.json` happened to land cleanly alongside gemini's `@axe-core/playwright` addition because the edits touched different lines — that was fortunate, not guaranteed.
- **Relevance:** future sessions (either identity) should treat `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and the root `*.config.ts` files as de facto shared: always re-`Read` immediately before editing (never trust a stale in-context copy), prefer `Edit` over `Write` for surgical changes, run `git status`/re-read before every commit to catch concurrent uncommitted changes to the same files, and re-run `pnpm install` after any lockfile-affecting change to reconcile. If this keeps causing friction, it's worth a `state/HUMAN_DECISIONS.md` question about formally assigning these files (e.g., to whichever agent's task touches them first, first-come).

### N-009 — Gemini T0 queue status: T0-04 completed; T0-12 and T0-17 blocked on T0-03
- **Date:** 2026-09-19
- **Context:** `AGENT_SPLIT.md` section 4 steps 8 and 9 dictate that when an agent finishes its unblocked tasks and all remaining tasks in its own queue depend on tasks currently in progress by the other agent, it must record what it is waiting on and stop without inventing work or claiming the other agent's tasks.
- **Observation:** `T0-04` (demo page static structure and accessibility suite) is `DONE` with `pnpm verify` fully green (107 unit tests, 7 e2e tests passing, axe-core 0 serious/critical violations). Gemini's remaining Tier 0 tasks are `T0-12` (minimal options page, depends on T0-02 and T0-03) and `T0-17` (highlight overlay, depends on T0-03). Both are blocked on `T0-03` (manifest and shells, currently in progress by `claude`). Per `AGENT_RULES.md` R7.1, T1 tasks cannot be started while T0 tasks remain TODO/BLOCKED.
- **Relevance:** Pausing execution here per `AGENT_SPLIT.md` section 4 step 9. Once `claude` completes `T0-03` and marks it `DONE` in `state/STATUS.md`, `gemini` can immediately proceed with `T0-12` and `T0-17`.

### N-010 — Options page (T0-12) implementation and Playwright extension test flow
- **Date:** 2026-09-19
- **Context:** T0-12 implements the minimal options page (`src/pages/options.html`, `src/pages/options.ts`, F-21) providing API key entry, Gemini model override, verbosity selector, STT mode display, offline STT model installer, and integration gate runners (IG-01, IG-03, IG-06, IG-10).
- **Observation:** In Playwright persistent-context tests, navigating to an extension page (`chrome-extension://${extId}/src/pages/options.html`) requires the extension ID. The extension service worker registers and awakens reliably upon initial page navigation (e.g. `await page.goto(server.url)`), allowing safe resolution of `extId` via `ctx.serviceWorkers()`. Gate runner functions output standard copy-pasteable markdown blocks per `state/INTEGRATION_GATES.md` specification. E2E test asserts the API key string is never rendered or leaked to any other page's DOM or storage.
- **Relevance:** T0-13 (Gemini client and resolver) is unblocked on the options page requirement. `options.spec.ts` passes consistently in <4s without flakes.


