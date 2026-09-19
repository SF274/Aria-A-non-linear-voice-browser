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
