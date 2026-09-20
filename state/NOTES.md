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

### N-011 — Gemini T0 task queue is fully completed
- **Date:** 2026-09-19
- **Context:** `AGENT_SPLIT.md` section 3 assigns `T0-04`, `T0-12`, and `T0-17` to `gemini`. All three tasks are now `DONE` with all acceptance criteria in `SPEC.md` section 16 passing, verified via `pnpm verify` (155 unit/DOM tests, 10 e2e tests passing).
- **Observation:** Under `AGENT_RULES.md` R7.1, T1 tasks (`T1-01`, `T1-06`, `T1-07`, `T1-08`) cannot be started while T0 tasks remain `TODO`. Under `AGENT_SPLIT.md` section 4 step 9, when an agent's unblocked tasks are complete, it records what it is waiting on and stops without inventing work or taking tasks from the other agent's list.
- **Relevance:** If operating strictly under `AGENT_SPLIT.md`, `gemini` is waiting on `claude` to complete the remaining T0 foundation tasks (`T0-06` through `T0-11`, `T0-13` through `T0-16`, `T0-18`, `T0-19`). If operating in solo/primary autonomous agent mode (per user directives), the agent should proceed along the critical path to `T0-06` / `T0-07`.

### N-012 — T0-07 Local Resolver and Gate IG-07 passing with 80% tier-one hit rate
- **Date:** 2026-09-19
- **Context:** T0-07 implements the local resolver and scoring engine (`src/sw/resolver/local.ts`, `src/sw/resolver/score.ts`, SPEC 7.1–7.4, 7.6.2). Performance gate IG-07 requires tier-one confident resolution for at least 12 of 20 scripted commands in `test/fixtures/commands.json`.
- **Observation:** Standard FuzzyWuzzy `token_set_ratio` contains a well-known vulnerability when comparing strings that share common suffix tokens (e.g. "flight") alongside short distinct tokens like numbers or times ("615 am" vs "105 pm"). Concatenating the shared intersection ("flight") to both difference sets yields an artificially inflated character similarity ratio (`r12 = 0.8462`) because digits/short words have high anagram overlap, causing 1.0 - 0.8462 < 0.10 (failing the `LOCAL_MARGIN` threshold). Weighting `r12` by token set overlap (`tokenOverlap = 2 * intersection.length / (set1.size + set2.size)`) when neither string is a subset cleanly preserves the margin between distinct numerical targets without degrading genuine subset matches (like "select 9:40 flight" vs "Select 9:40 AM flight").
- **Relevance:** Gate IG-07 passed with 16 of 20 (80.0%) scripted commands resolving CONFIDENT on tier one. All named F-05 acceptance criteria pass ("download the itinerary" returns AMBIGUOUS with exactly 2 download IDs, "make me a sandwich" returns MISS, disabled elements never win). Full `pnpm verify` passes with 167 Vitest tests and 10 Playwright e2e tests green.

### N-013 — T0-13 Gemini resolver (tier two) and client implementation completed
- **Date:** 2026-09-19
- **Context:** T0-13 implements the Tier Two Gemini model resolver (`src/sw/gemini/resolver.ts`, `src/sw/gemini/client.ts`, `src/sw/gemini/prompts.ts`, SPEC 5.3–5.6, 7.3–7.4, 8.2–8.6, 11.1–11.5).
- **Observation:** Prompt security rules require immutable compiled system prompts, structural delimiter separation (`<user_command>` vs `<page_elements>`), total exclusion of passwords and URLs in prompt elements, and sanitization to prevent delimiter breakout. API key is transmitted strictly in `x-goog-api-key` header with zero URL leakage. Network client enforces 2500 ms timeout via `AbortController`, single retry on 5xx, no retry on 429, and session-level disabling on 401/403. Model output undergoes strict shape validation (`ResolverResponseSchema`), out-of-range confidence clamping and 0.1 penalty, mode 'single' truncation, elementId index membership verification, and action schema validation.
- **Relevance:** All 9 fixtures from SPEC 17.4 and prompt shape assertions are tested via `test/unit/prompt-shape.spec.ts` and `test/unit/gemini-resolver.spec.ts`. All 21 tests pass. Gate script `scripts/gate-gemini.ts` added for `pnpm gate:gemini`. Full verification gate `pnpm verify` exits 0 with 271 unit/DOM/perf tests and 13 Playwright E2E tests green.


### N-014 — True-audio QA suite: how the microphone path behaves in Playwright's Chromium (probed, not assumed)
- **Date:** 2026-09-19
- **Context:** `test/e2e/qa-exhaustive.spec.ts` drives the extension with real 16-bit PCM WAV fixtures (`pnpm gen:audio`, `scripts/generate-test-audio.ts`, spoken by the OS voice) through `--use-file-for-fake-audio-capture`.
- **Observations (all measured):**
  - Chrome only honours the fake-capture file if it is canonical 16-bit PCM WAV; `scripts/generate-test-audio.ts` rebuilds the 44-byte header itself instead of trusting the synthesizer. Fixtures are 44.1 kHz mono.
  - The file is **re-read every time a capture stream opens** and each capture starts at sample 0. Two utterances in one browser session therefore work by overwriting the file between takes (`Qa.setAudio`). `%noloop` stops it repeating.
  - Chrome's speech service is unreliable on this synthetic voice. Across runs the same take produced nothing, `no-speech`, or wrong text ("play welcome baby", "Play Welcome Home" for "Book the 9:40 flight"). On-device recognition reports `downloadable`, then stays `downloading` for 150 s+ (never installs). Acting on it would make the suite flaky and wrong, so development builds honour a `qa.ignoreStt` session flag (`QA_IGNORE_STT_KEY`, compiled out of production) that logs what the recognizer heard and ignores it. The transcript is supplied through the SPEC 17.3 `test.transcript` hook. `QA_REAL_STT=1` lets the real recognizer through.
  - Chrome's recognizer fires `speechstart` on digital silence, so it is not evidence of speech. The suite proves what the microphone carried with a second capture stream in the page (peak and active milliseconds), and uses `audiostart` only to prove the recognizer opened the stream.
  - `ctx.route()` intercepts `fetch()` made by the extension service worker (Gemini, ElevenLabs) — but not when `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1` is set. Retry timing is measured inside the SW by wrapping `fetch`, not through Playwright's round trip.
  - `tab.audible` lingers ~1-2 s after a sound ends; it is a lagging signal. Playback start/stop is asserted through the timing of the SW's `tts.play` / `tts.stop` messages instead, with `tab.audible` as a secondary check.
  - `pnpm build` (production) strips the `test.transcript` hook. The QA suite builds a development bundle into `dist-test/` (`ECHO_BUILD_MODE=development ECHO_OUT_DIR=dist-test`) in `beforeAll`; `dist/` stays the production bundle. Before this change `__ECHO_DEV__` was never defined by `scripts/build.ts` at all, so the hook was dead code in every build.
- **Relevance:** IG-02 (`SpeechRecognition` in the offscreen doc) is proven for the *start* of recognition (`audiostart` in the SW) but the transcript quality on a real voice remains a manual gate (SPEC 17.7).

### N-015 — Defects the QA suite found, and what fixed them
- **Date:** 2026-09-19
- Nothing connected the finished modules: `stt.result` and `test.transcript` ended in `TODO (T0-13)`; the resolver, validator, executor and TTS were never called from the service worker. Fixed by `src/sw/pipeline.ts` (DEV-005).
- A stale `stt.error` (the recognizer's own `end`, or an aborted instance) sent a running command back to IDLE. `stt.error` is now only honoured in LISTENING / TRANSCRIBING, and `speech.ts` ignores events from a superseded `SpeechRecognition` instance.
- KEY_DOWN "talking over" the system moved to LISTENING but never sent `stt.start`: no new capture began. Fixed in `src/sw/index.ts`.
- OS key auto-repeat re-sent `key.down` and would have aborted the capture mid-utterance. `hold-to-talk.ts` now ignores `event.repeat`.
- `tts.stop` arriving while an ElevenLabs clip was still decoding was lost, and the confirmation then played over the user. Fixed with an epoch in the content script and an abort guard in `tts.ts`.
- `reResolveElement` ignored the 0.15 movement limit for a lone match (DEV-003).
- `fill` wrote the value twice, defeating React's value tracker, and left the field focused so the next hold-to-talk press was typed into it (DEV-004).
- `buildId` was regenerated on every rebuild, so a clarification could never survive the 1.5 s index cache. The id is now kept when the index content is unchanged.
- `demo/app.js` used `export` in a classic `<script>` (SyntaxError): none of the demo page's click/search/confirm behaviour ever ran.
- `transitionTo` was an unserialized read-modify-write on storage; transitions are now queued, and returning to IDLE clears a pinned clarification.
- A failed step's partial-failure sentence would have said `el_27`; the executor now reports the indexed name for `not_found`.
- **Not fixed / out of scope:** `hold-to-talk.ts` reads `holdKey` from a top-level storage key but the options page saves it inside `settings`, so a changed hold key would never apply (default `Space` is unaffected). Reported, not changed. **Fixed later the same day, see N-016.**

### N-016 — Global commands, hold key, ticks, and the "rate limited" sentence
- **Date:** 2026-09-19
- **Task mapping:** the human's directive named these "F-14 Tab Management, F-15 Web Search, F-16 Save to Keep". In SPEC those three are all **F-15** (SPEC 6.18, task **T1-08**); SPEC's F-14 is page Q&A (T1-07) and F-16 is the demo page (T0-04 / T1-01). Only T1-08 changes state. T1-08 was assigned to `gemini` in AGENT_SPLIT; built by `claude` on the human's instruction.
- **Hold key:** `hold-to-talk.ts` now reads `settings.holdKey` on load and follows `storage.onChanged` for `settings` in the `local` area. A top-level `holdKey` entry is ignored. Covered in `test/unit/hold-to-talk.spec.ts`.
- **Ticks:** the executor plays one SPEC 9.3 positional tick per step when `ExecuteRequest.playTicks` (the pipeline sets it for sequences, when `settings.audioEnabled`). While the service worker waits on the model, the content script plays a quiet 30 ms "still working" click: first after 500 ms, then every 800 ms, at most 6, stopped before any speech (SPEC 9.1). Both degrade to silence (SPEC 9.6). This is **not** T1-02 (the scan, `audio.ts` engine and clarify ticks are still unbuilt).
- **Rate limited:** DEV-007.
- **Bug found while writing the router:** a Python heredoc turned the regex `\b` into a literal backspace character, so "keep" alone was routed as "save this page". Caught by the router's negative tests; every `.ts` file under src/test/scripts was then scanned for control characters (none).
- **Playwright finding:** a tab opened by `chrome.tabs.create({ url })` makes its first navigation before `context.route` can intercept it, so the QA suite hit the real Google. Suite F now spies on `chrome.tabs.create` inside the service worker, records the URL, and opens `about:blank` instead.

### N-017 — Page questions, tabs, the date, and IG-03
- **Date:** 2026-09-19
- **Why it failed before:** nothing extracted page text, and SPEC's F-13 / F-14 (T1-06 / T1-07) were unbuilt. A question like "summarize the page" reached the click-resolver, which can only answer with "which one do you mean?".
- **Built:** `src/content/page-text.ts` (`page.text` handler), `src/sw/gemini/qa.ts` (separate prompt, plain-text response, spoken only), `src/sw/gemini/context.ts` (date, page, tabs), `src/sw/commands/ask.ts` (router), `src/sw/commands/local-answers.ts`, and the wiring in `pipeline.ts`. The resolver prompt was rewritten (ordinals, speech-recognition errors, relative dates, questions return no actions) and keeps SPEC 8.2's closing sentence verbatim.
- **Edge cases decided:** a polite "can you click submit" is a command; "do the booking" is a command, "do you see a login form" is a question; "what time is the flight" is a page question, "what time is it" is the clock; while a clarification is open, only summaries and clock/tab questions are taken as questions; a tab name in a question ("the airport page") is matched only among tabs in the same window, and the tab the user is on wins a near tie; a click that opens a new tab answers about the new tab and makes it the remembered tab; a click that changes nothing answers about the page as it is after about 1.2 s.
- **Tests:** `ask-routing.spec.ts` (81), `qa-inert.spec.ts`, `browser-context.spec.ts`, `test/dom/page-text.spec.ts`, IG-03 cases in `test/dom/options.spec.ts`, and QA suite G (11 real-browser tests; Gemini stubbed, every request inspected).
- **Not verified:** any of this against the live Gemini model. The prompts, the 40 / 45 word limits and "say so if it is not on the page" are instructions, not measurements. `pnpm gate:gemini` (needs a key) is the place to check.
- **Known limits:** text inside iframes and shadow DOM is not read; a single-page app that changes its URL late is described before it finishes; page text goes to Google (HD-09), so a password manager page or an inbox is sent if the user asks about it.
- **IG-03:** the options button now runs the ten chunks silently (volume 0, rate 10) and waits for real `end` events; the old code reported PASS after 600 ms whether or not speech finished, and then spoke for a minute. The silent run cannot exercise the ~15 s network-voice cutoff (AS-03). The gate stays `NOT_RUN` until a human hears a real-time chunked passage once. **Measured on the dev machine:** the engine paces itself in real time even at volume 0 and rate 10, so the ten-chunk run takes about 14 s (the events are identical at volume 0 and volume 1, so silence rests on `chrome.tts` honouring `volume: 0`, which the automated tests cannot hear). The button shows "Running IG-03…" meanwhile; `options.spec.ts` now allows 40 s.
- **Caught by the SPEC 17.5 security test D6:** the first version of the resolver context included the page's hostname, which SPEC 8.3 keeps out of the resolver request. The resolver's context is now the date, the time and the page title only (`ContextScope`), and G10 and `browser-context.spec.ts` assert it.

### N-018 — The audio engine, and what a mutation sounds like
- **Date:** 2026-09-19
- **Directive:** HD-10. Deviations in DEV-009.
- **Built:** `src/content/audio/engine.ts`, `mapping.ts`, `transport.ts`, `mutation.ts`. `audio-stubs.ts` is deleted and its three import sites repointed; `executor.ts` now holds a `batch` activity for the length of a run so SPEC 9.8 step 5 has something to suppress against.
- **The sound, in one paragraph:** a mutation is described by how much arrived, where it landed and what kind of thing it was. Magnitude picks a root from a descending A minor pentatonic table (110 Hz down to 55 Hz) — bigger means deeper — and interpolates the swell's length, gain and filter brightness with it. The swell is two sawtooth voices detuned 7 cents apart and panned to either side of the change's centroid, through a lowpass at Q 7 whose cutoff opens from 1.25x the root to as much as 14x over the attack and then settles to 2x; a sine at the root replaces the fundamental the filter takes out. Sawtooth rather than sine because at a 55 Hz root the fundamental is inaudible on laptop headphones and the harmonics are what carry the pitch. Over that, SPEC 9.8's point tones, unchanged. Text churn with no new control gets up to five 18 ms square pulses through a bandpass at Q 12, an ascending arpeggio four octaves above the swell roots, panned across the span the change covered.
- **Why quantized pitches:** two mutations in a row then make an interval instead of a glide, and the same size of change always sounds like the same note. Nothing uses `Math.random`, which is also why the e2e assertions are exact rather than approximate.
- **Performance:** the observer callback counts and does nothing else — no `getBoundingClientRect`, no `querySelectorAll`, no per-node allocation beyond a sample of eight, and it stops at 256 records. `test/dom/mutation-sonification.spec.ts` asserts that by spying on both methods during a 400-element storm. Geometry comes free from the index entries when a burst has any, so only a churn-only burst measures anything, and then at most eight elements, at most once per 1200 ms.
- **Two defects the tests caught before they shipped:** (1) a burst of two or three non-interactive elements with no text passed the threshold, scheduled nothing, and still spent the 1200 ms rate limit — so the event the user was waiting for arrived inside the window and was dropped. The churn layer now also carries a small structural change, and a burst that schedules nothing is not charged for the window. (2) `readyContext()` resumed the context through the SPEC 9.6 rule 4 path. Mutations fire before the user has touched the page, so that resume is refused by the autoplay policy, and rule 4 would have concluded the page has no audio — silencing the listen tone and every cue afterwards. The ambient path now resumes quietly.
- **Not built:** the F-10 scan (T1-03) and SPEC 9.6 rule 4's spoken "Audio cues need a click on the page first." T1-02 stays `IN_PROGRESS`.
- **Not verified:** the sound itself. Every assertion in the suite is about what was scheduled — frequency, pan, gain, timing — not about what comes out of the headphones. Someone has to put headphones on, open the demo page, hold the key once to resume the context, and click `Search flights`. The levels (swell peak 0.045–0.105, points 0.6x the SPEC 9.3 peaks, ticks 0.045) are first guesses; the cue bus limiter at -6 dB is what stops an overlap clipping, and it has never been heard either.

### N-0xx — GPTZero's response shape was confirmed by probing the live endpoint, not by reading the docs (F-22)
The Stoplight page the human linked renders its content with JavaScript, so it
fetches as an empty shell. Rather than guess, `POST https://api.gptzero.me/v2/predict/text`
was probed with a deliberately invalid key: it answers `403 {"error":"API key has
no owner"}`, which confirms the URL, the method and that the key belongs in
`x-api-key`. The **response** shape for a successful call is still unconfirmed
by observation — no valid key was available in this session.

That is why `parseVerdict` reads the body defensively rather than against a
fixed schema: it takes `class_probabilities.ai`, then `completely_generated_prob`,
then `average_generated_prob`, and returns *no verdict* if none of them is
present and numeric. A shape this code has not seen degrades the feature to
silence; it can never produce a wrong warning. When someone runs it with the
real key, the thing worth checking is which of those three fields actually
arrives — and what an ordinary human-written page scores, since the open risk
in F-22 is false positives, not false negatives.

### N-019 — Why a guarded click is still a state-blind click (HD-14, DEV-012)
The executor already read the state before clicking: `check` clicked only when
`!checked`, `uncheck` only when `checked`. That looks like it settles the
direction, and it does not, because the guard and the click are two separate
things and only the guard is absolute. A click toggles whatever the element is
at the instant it lands.

Two ordinary pages break it, and both were turned into tests before the fix:

1. **A cancelled click.** A wrapper that owns its own checkbox state commonly
   calls `preventDefault()` in `onClick`. The HTML activation behaviour then
   *restores* the previous checkedness, so the click leaves the box exactly as
   it was and the executor reports success. `test/dom/executor.spec.ts`,
   "still turns the box off when the page cancels the click", fails against the
   old code and passes against the new.
2. **A disagreement about the current state.** The guard reads the DOM; a
   controlled component renders from its own. When those differ, the guard
   picks the wrong branch — the case that started this.

The fix is to stop expressing an absolute request with a relative operation.
`check` and `uncheck` now write `checked` through the prototype setter and
dispatch `input` and `change`, the same bypass `fill` uses (DEV-004), and the
two are shared in `nativePropertySetter` / `dispatchInputAndChange`.

**What the new tests do and do not prove.** Four of the six new DOM assertions
pass against the old implementation too, because in jsdom `element.click()`
toggles `checked` and fires the same events, so a React-style tracker notices
it either way. They are regression guards, not reproductions. The two that
discriminate are the cancelled-click test above and "never click to get there",
which asserts zero `click` events on a native checkbox.

**The intent had to be fixed upstream as well**, or the executor would never see
the verb. Three places dropped it: the resolver prompt never told the model that
a checkbox takes `check`/`uncheck` (so it answered `click`, which is valid for
the role and passed every check); the clarification path replaced the verb with
`defaultVerb`, turning "uncheck one of these two" into a click once the user
said which one; and the local resolver would let a lexicon toggle word reach a
link or button, where SPEC 7.6.1 rule 8 refuses the batch out loud. The model's
`click` is now rewritten to the named toggle — but only for a lone action (in a
sequence the leading verb says nothing about later steps) and only onto a role
that can take it.

**Not verified:** nobody has spoken "uncheck" at a real page. Every assertion
here is jsdom and a stubbed model. The demo page's three filter checkboxes are
plain inputs with no framework behind them, so the path this fixes is the one a
judge is *least* likely to hit on the demo page itself.
