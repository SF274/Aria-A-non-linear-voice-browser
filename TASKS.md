# TASKS.md — implementation task graph

Derived from `SPEC.md`. Every task names the SPEC sections to read, its dependencies, its tests, and the gates that block it.

**Selection rules are in `SURF.md` section 3.** Do not select a task by scanning this file top to bottom.

Field meanings:

- **Feature** — the `SPEC.md` section 2.2 feature ID this task serves.
- **Read** — SPEC sections to read in full before implementing. Not optional.
- **Depends** — task IDs that must be `DONE` first.
- **Gate** — integration gates that must be `PASS` or `N/A` before this task can be marked `DONE`.
- **Done when** — the completion condition. Always references SPEC section 16.
- **Est** — person-hours.

---

## Tier 0 — mandatory MVP (19 person-hours)

### T0-01 — Repository scaffold and build pipeline
- **Feature:** F-01 · **Est:** 1.5
- **Read:** SPEC 8.7, 8.8, 13.3, 17.1
- **Depends:** none · **Gate:** none
- **Components:** root, `vite.config.ts`, `package.json`, `tsconfig.json`
- **Build:** Vite + `@crxjs/vite-plugin` or an equivalent MV3 bundler, TypeScript strict, Vitest, Playwright, ESLint. `pnpm build`, `pnpm test`, `pnpm test:e2e`, `pnpm verify`, `pnpm demo`. `.env.example` committed, `.env` git-ignored.
- **Tests:** `test/unit/smoke.spec.ts` asserts the build output contains `manifest.json` and that `pnpm verify` exits 0.
- **Done when:** F-01 criteria in SPEC 16 pass.

### T0-02 — Shared contracts and constants
- **Feature:** F-01 · **Est:** 1.5
- **Read:** SPEC 5 (all), 7.2.4, 9.3, 11.5
- **Depends:** T0-01 · **Gate:** none
- **Components:** `src/shared/contracts.ts`, `src/shared/constants.ts`
- **Build:** Every interface in SPEC 5 as a runtime-validated schema (Zod). Every tunable constant from SPEC 7.2.4, 9.3, 9.7, 11.4, 12.2 in one file. The message envelope guard helper.
- **Tests:** `test/unit/contracts.spec.ts` round-trips a valid instance of every schema and rejects one malformed instance of each.
- **Done when:** every schema in SPEC 5 exists, is exported, and has both a positive and a negative test.
- **Note:** This task unblocks the most other tasks. It is the correct first implementation task after scaffolding.

### T0-03 — Manifest, service worker shell, content script shell
- **Feature:** F-01 · **Est:** 1
- **Read:** SPEC 4.1, 4.2, 5.15, 5.16, 8.7, 8.8
- **Depends:** T0-02 · **Gate:** none
- **Components:** `manifest.json`, `src/sw/index.ts`, `src/content/index.ts`
- **Build:** Exactly the six permissions in SPEC 8.7 and no others. Message listeners in both that return early on envelope mismatch. Content script re-injection helper using `chrome.scripting`.
- **Tests:** `test/unit/manifest.spec.ts` asserts the permission set matches SPEC 8.7 exactly, character for character, and that `debugger`, `downloads`, `history`, `cookies`, `webRequest`, `activeTab` are absent.
- **Done when:** F-01 criteria pass and the extension loads with zero console errors.

### T0-04 — Demo page, static structure
- **Feature:** F-16a · **Est:** 1
- **Read:** SPEC 15.1 to 15.4, 15.6 to 15.11
- **Depends:** T0-01 · **Gate:** none
- **Components:** `demo/index.html`, `demo/styles.css`
- **Build:** Static markup only. Every accessible name exactly as specified. Correct landmarks and `label for`. No password inputs. The promo video muted. The two identically-named Download buttons.
- **Tests:** `test/e2e/demo-a11y.spec.ts` (axe-core, zero serious/critical), `test/e2e/demo-names.spec.ts` asserts every accessible name in SPEC 15 exists exactly once except the two intentional duplicates.
- **Done when:** F-16a criteria pass.
- **Note:** This is a T0 task because it is the fixture every other T0 test runs against. The page's dynamic behaviour is T1-01.

### T0-05 — Element index builder
- **Feature:** F-04 · **Est:** 3
- **Read:** SPEC 5.1, 5.2, 12.1 to 12.7, 12.9
- **Depends:** T0-02, T0-03, T0-04 · **Gate:** IG-05
- **Components:** `src/content/index-builder.ts`, `src/content/observer.ts`
- **Build:** Selector union and exclusions per 12.2. `dom-accessibility-api` for names, `aria-query` for implicit roles. Document-relative coordinate normalization per 12.6. `MutationObserver` with the 150 ms debounce and the runaway guard per 12.9.
- **Tests:** `test/dom/index-builder.spec.ts` (jsdom fixtures covering each exclusion rule, each name fallback, disabled/readonly, `aria-hidden` ancestors, closed `details`), `test/e2e/index-demo.spec.ts` (full demo page count and names), `test/perf/index-build.spec.ts` (120 elements under 120 ms).
- **Done when:** F-04 criteria pass and IG-05 is `PASS`.

### T0-06 — Transcript normalization and verb lexicon
- **Feature:** F-05 · **Est:** 1.5
- **Read:** SPEC 7.2.1, 7.2.2, 10.8
- **Depends:** T0-02 · **Gate:** none
- **Components:** `src/shared/normalize.ts`
- **Build:** The seven normalization steps in order. `roleHint` extraction. The verb lexicon with value/target splitting on " in ", " into ", " as ".
- **Tests:** `test/unit/normalize.spec.ts` with at least 30 input/output pairs covering every step, every verb row, and the "book the 9:40 flight" case producing a remainder containing `940`.
- **Done when:** F-05's normalization criterion passes.

### T0-07 — Local resolver
- **Feature:** F-05 · **Est:** 2.5
- **Read:** SPEC 7.1, 7.2.3, 7.2.4, 7.4
- **Depends:** T0-05, T0-06 · **Gate:** IG-07
- **Components:** `src/sw/resolver/local.ts`, `src/sw/resolver/score.ts`
- **Build:** `tokenSetRatio`, the five boosts and the disabled penalty, the three-way threshold decision. Constants imported from `src/shared/constants.ts`, never inlined.
- **Tests:** `test/unit/resolver-local.spec.ts` against `test/fixtures/commands.json` (20 scripted commands with expected tier and target), plus the three named cases in F-05.
- **Done when:** F-05 criteria pass and IG-07 is `PASS` (at least 12 of 20 on tier one).

### T0-08 — Session state machine
- **Feature:** F-03, F-07 · **Est:** 2
- **Read:** SPEC 4.5, 6.1, 6.4, 6.19, 13.2
- **Depends:** T0-02, T0-03 · **Gate:** none
- **Components:** `src/sw/session.ts`
- **Build:** Every transition in 4.5. Persistence to `chrome.storage.session`. The interrupt rule: `KEY_DOWN` in any state cancels and returns to `LISTENING`. Timeouts: 3000 ms transcribing, 15000 ms clarifying.
- **Tests:** `test/unit/session.spec.ts` drives every transition including all five error branches and asserts the machine survives a simulated service worker restart by rehydrating from storage.
- **Done when:** every transition in SPEC 4.5 has a passing test.

### T0-09 — Microphone permission flow
- **Feature:** F-02 · **Est:** 1.5
- **Read:** SPEC 4.3, 4.4, 6.2, 10.2
- **Depends:** T0-03 · **Gate:** IG-02
- **Components:** `src/pages/permission.html`, `src/pages/mic.html`, `src/sw/offscreen.ts`
- **Build:** `ensureMicPermission()` opening a real tab. `ensureOffscreen()` with the already-exists guard. `mic.html` built as the documented iframe fallback even if the offscreen path works.
- **Tests:** `test/e2e/mic-permission.spec.ts` with `--use-fake-ui-for-media-stream`; denial path simulated by injecting a `NotAllowedError`.
- **Done when:** F-02 criteria pass and IG-02 is `PASS`.

### T0-10 — Speech recognition in the offscreen document
- **Feature:** F-03 · **Est:** 2
- **Read:** SPEC 4.3, 6.3, 10.3, 10.4, 10.5
- **Depends:** T0-08, T0-09 · **Gate:** IG-01, IG-02
- **Components:** `src/offscreen/offscreen.ts`, `src/offscreen/stt.ts`
- **Build:** `selectRecognitionMode()` with session caching. A new `SpeechRecognition` per utterance. The 15 s watchdog. Every error code in 10.5 mapped to its specified behaviour.
- **Tests:** `test/unit/stt-errors.spec.ts` injects each synthetic error event and asserts the mapped behaviour; `test/e2e/stt-smoke.spec.ts` with fake media.
- **Done when:** F-03 criteria pass.

### T0-11 — Hold-to-talk capture
- **Feature:** F-03 · **Est:** 1
- **Read:** SPEC 6.1, 9.4, 9.6
- **Depends:** T0-03, T0-08 · **Gate:** none
- **Components:** `src/content/hotkey.ts`
- **Build:** Capture-phase listeners. Editable-target guard. 250 ms minimum hold. `AudioContext` creation and `resume()` inside the keydown handler (this is the only valid user gesture the system gets).
- **Tests:** `test/dom/hotkey.spec.ts` covers the editable guard, the short-tap discard, and the watchdog.
- **Done when:** the hold-to-talk criteria within F-03 pass.

### T0-12 — Minimal options page
- **Feature:** F-21 · **Est:** 1
- **Read:** SPEC 5.13, 8.6, 10.3, 13.1
- **Depends:** T0-02, T0-03 · **Gate:** none
- **Components:** `src/pages/options.html`, `src/pages/options.ts`
- **Build:** API key entry, model override, verbosity, current STT mode display, "Install offline model" button, and one button per manually-runnable gate (IG-01, IG-03, IG-06, IG-10).
- **Tests:** `test/e2e/options.spec.ts` asserts the key persists and never appears in any other page's DOM.
- **Done when:** F-21 criteria pass.
- **Note:** Required before the Gemini tier can be exercised at all. Do not defer it.

### T0-13 — Gemini client and response validation
- **Feature:** F-06 · **Est:** 3
- **Read:** SPEC 5.3 to 5.6, 7.3, 8.2 to 8.6, 11.1 to 11.5
- **Depends:** T0-02, T0-07, T0-12 · **Gate:** IG-06
- **Components:** `src/sw/gemini/client.ts`, `src/sw/gemini/resolver.ts`, `src/sw/gemini/prompts.ts`
- **Build:** Injectable `fetch`. The exact request body in 11.3. `RESOLVER_SYSTEM_PROMPT` as a compiled constant, never templated. `PromptElement` projection excluding password elements and all URLs. Every error branch in 11.4. `AbortController` at 2500 ms with no retry.
- **Tests:** `test/unit/gemini-resolver.spec.ts` against all nine fixtures in SPEC 17.4; `test/unit/prompt-shape.spec.ts` asserts the request body contains no URL, no HTML, and no password element, and that the key is a header not a query parameter.
- **Done when:** F-06 criteria pass and IG-06 is `PASS`.

### T0-14 — Action validation
- **Feature:** F-07 · **Est:** 1
- **Read:** SPEC 7.6.1, 7.6.2, 8.3
- **Depends:** T0-02, T0-05 · **Gate:** none
- **Components:** `src/sw/execute/validate.ts`
- **Build:** All nine validation rules in 7.6.1 and the verb/role table in 7.6.2. Batch-abort semantics: one invalid action rejects the whole batch.
- **Tests:** `test/unit/validate.spec.ts` with one failing case per rule, plus a batch containing one invalid action asserting zero execution.
- **Done when:** every rule in 7.6.1 has a failing-case test.

### T0-15 — Executor with re-resolution
- **Feature:** F-07 · **Est:** 2.5
- **Read:** SPEC 5.7, 5.8, 7.6.3, 12.8, 12.10
- **Depends:** T0-05, T0-14 · **Gate:** none
- **Components:** `src/content/executor.ts`, `src/content/reresolve.ts`
- **Build:** Per-action re-resolution (not per batch). All seven verbs. `fill` dispatching both `input` and `change`. `buildId` rejection. The 0.15 normalized-unit movement threshold.
- **Tests:** `test/dom/executor.spec.ts` per verb; `test/e2e/executor-stale.spec.ts` removes the target between resolve and execute and asserts `not_found` plus batch abort; a framework-controlled input fixture asserting `fill` actually updates state.
- **Done when:** F-07 criteria pass.

### T0-16 — TTS service
- **Feature:** F-08 · **Est:** 1.5
- **Read:** SPEC 6.12, 10.6
- **Depends:** T0-02, T0-08 · **Gate:** IG-03
- **Components:** `src/sw/tts.ts`
- **Build:** Voice selection per 10.6.2. Sentence chunking above 200 characters with `enqueue: true`. `chrome.tts.stop()` on every `key.down`. Both verbosity template sets. No `pause`/`resume` keepalive on the `chrome.tts` path.
- **Tests:** `test/unit/tts.spec.ts` covers every template in 10.6.3 for both verbosity levels, the chunking boundary, and interruption within 100 ms.
- **Done when:** F-08 criteria pass and IG-03 is `PASS`.

### T0-17 — Highlight overlay
- **Feature:** F-09 · **Est:** 0.5
- **Read:** SPEC 6.11, 9.9
- **Depends:** T0-03 · **Gate:** none
- **Components:** `src/content/highlight.ts`, `src/content/overlay.css`
- **Build:** Class-based, injected stylesheet, no inline style mutation, cleared on `IDLE`.
- **Tests:** `test/dom/highlight.spec.ts` asserts the page's own inline styles are byte-identical before and after.
- **Done when:** F-09 criteria pass.

### T0-18 — Security test suite
- **Feature:** cross-cutting · **Est:** 1.5
- **Read:** SPEC 8 (all), 17.5
- **Depends:** T0-13, T0-14, T0-15 · **Gate:** none
- **Components:** `test/e2e/security/`
- **Build:** All six tests in SPEC 17.5, plus the `test.transcript` production-exclusion test from 17.3.
- **Tests:** itself.
- **Done when:** all seven tests pass.
- **Note:** `AGENT_RULES.md` R4.6 forbids deferring this past the integration freeze.

### T0-19 — Chain harness (IG-CHAIN)
- **Feature:** cross-cutting · **Est:** 1
- **Read:** SPEC 18.1, 17.2, 17.3
- **Depends:** T0-10, T0-11, T0-15, T0-16, T0-17 · **Gate:** IG-04
- **Components:** `test/e2e/chain.spec.ts`
- **Build:** The full chain from a `test.transcript` injection through to spoken confirmation, asserted on the demo page. A `--repeat 10` mode.
- **Tests:** itself.
- **Done when:** IG-CHAIN passes 10 consecutive times and the result is recorded.

---

## Tier 1 — differentiators (11 person-hours)

### T1-01 — Demo page dynamic behaviour
- **Feature:** F-16b · **Est:** 1
- **Read:** SPEC 15.5, 15.7, 15.9
- **Depends:** T0-04 · **Gate:** none
- **Components:** `demo/app.js`
- **Build:** `RESULTS_DELAY_MS = 800` results injection, booking form validation, the confirmation panel, `dataset.lastDownload`.
- **Tests:** `test/e2e/demo-dynamics.spec.ts`.
- **Done when:** F-16b criteria pass.

### T1-02 — Audio engine
- **Feature:** F-10 · **Est:** 2
- **Read:** SPEC 9.1 to 9.6
- **Depends:** T0-05, T0-11 · **Gate:** none
- **Components:** `src/content/audio/engine.ts`, `src/content/audio/mapping.ts`
- **Build:** Singleton `AudioContext`. The exact mappings in 9.3. Per-tone node creation. `currentTime`-based scheduling, never `setTimeout`. The suspended-context fallback path.
- **Tests:** `test/unit/audio.spec.ts` with a mock `AudioContext` asserting pan monotonic in x, frequency monotonically decreasing in y, correct oscillator type per role class, and the exponential-ramp-to-0.0001 rule.
- **Done when:** the mapping and lifecycle criteria within F-10 pass.

### T1-03 — Page layout scan with synchronized highlight
- **Feature:** F-10 · **Est:** 2
- **Read:** SPEC 9.7, 9.9, 6.13
- **Depends:** T1-02, T0-17 · **Gate:** IG-08
- **Components:** `src/content/audio/scan.ts`
- **Build:** `SCAN_MAX = 30` at 90 ms, sorted y then x, total 2700 ms. Highlight scheduled to the same offsets. The "30 of n" spoken tail.
- **Tests:** `test/e2e/scan-sync.spec.ts` asserts tone `i` and highlight `i` within 30 ms for all 30, and total duration 2700 ms ± 60 ms.
- **Done when:** F-10 criteria pass and IG-08 is `PASS`.
- **Note:** The synchronized highlight is mandatory. Without it the feature does not land in a ten-second window and should not be considered done.

### T1-04 — Confidence gate and clarification
- **Feature:** F-11 · **Est:** 2
- **Read:** SPEC 5.9, 7.4, 7.5, 9.4
- **Depends:** T0-07, T0-13, T0-16, T1-02 · **Gate:** none
- **Components:** `src/sw/resolver/clarify.ts`
- **Build:** The three-level question formation in 7.5.1 (distinguishing token, then region, then ordinal). Candidate highlighting in `.echo-candidate` plus one positional tick per candidate at 120 ms spacing. The pinned-candidate reply path with the lowered 0.55 threshold. `buildId` invalidation.
- **Tests:** `test/e2e/clarify.spec.ts` covering the download ambiguity end to end, the ordinal reply, the 15 s expiry, and the `buildId`-change discard.
- **Done when:** F-11 criteria pass.

### T1-05 — Bounded multi-action sequences
- **Feature:** F-12 · **Est:** 1.5
- **Read:** SPEC 7.7, 5.7, 5.8, 11.3
- **Depends:** T0-13, T0-15 · **Gate:** none
- **Components:** `src/sw/execute/sequence.ts`
- **Build:** Sequence-signal detection. `mode: "sequence"` with `maxItems: 5`. 250 ms step delay. Panned tick per step. Stop-on-failure with the step named in the confirmation. No re-planning, no second model call.
- **Tests:** `test/e2e/sequence.spec.ts` runs the primary demo command 5 consecutive times against a fixture and asserts the booking completes; a step-3-failure fixture asserts steps 1 and 2 remain applied.
- **Done when:** F-12 criteria pass.

### T1-06 — Page text extraction, summary, and cache
- **Feature:** F-13 · **Est:** 1.5
- **Read:** SPEC 8.4, 8.9, 11.6, 5.12, 13.1
- **Depends:** T0-13 · **Gate:** none
- **Components:** `src/content/page-text.ts`, `src/sw/gemini/summary.ts`, `src/sw/cache.ts`
- **Build:** Landmark-aware extraction, sanitization, the 50-entry LRU cache, the pre-seeded demo page summary.
- **Tests:** `test/unit/summary-cache.spec.ts` (eviction at 51), `test/e2e/summary-offline.spec.ts` (cached summary plays with the network blocked).
- **Done when:** F-13 criteria pass.

### T1-07 — Page question answering
- **Feature:** F-14 · **Est:** 1
- **Read:** SPEC 8.5, 11.7
- **Depends:** T1-06 · **Gate:** none
- **Components:** `src/sw/gemini/qa.ts`, `src/sw/route.ts`
- **Build:** Interrogative-shape routing before the resolver's model tier. A separate prompt, a separate response handler, plain-text output, spoken only.
- **Tests:** `test/unit/qa-inert.spec.ts` feeds the Q&A handler a JSON action array and asserts it is spoken verbatim and never executed.
- **Done when:** F-14 criteria pass.

### T1-08 — Tabs, search, bookmark
- **Feature:** F-15 · **Est:** 1
- **Read:** SPEC 6.18, 13.3
- **Depends:** T0-06, T0-08 · **Gate:** none
- **Components:** `src/sw/commands/browser.ts`
- **Build:** The fixed intent table, matched before element resolution. `SEARCH_TEMPLATE` as a compile-time constant with `encodeURIComponent`. Bookmark, not download, not print.
- **Tests:** `test/e2e/browser-commands.spec.ts` per row, plus a spy asserting the Gemini client is never called for any of them.
- **Done when:** F-15 criteria pass.

### T1-09 — Blackout overlay
- **Feature:** primary demo · **Est:** 0.5
- **Read:** SPEC 1.6, 15.8
- **Depends:** T0-17 · **Gate:** IG-09
- **Components:** `src/content/blackout.ts`
- **Build:** `position: fixed`, full viewport, `z-index: 2147483646`, `pointer-events: none`. Toggled by message and by hotkey.
- **Tests:** `test/e2e/blackout.spec.ts` asserts a click still lands on a covered element while the overlay is active.
- **Done when:** F-11's demo dependency is satisfied and IG-09 is `PASS`.

### T1-10 — Golden path end-to-end test
- **Feature:** cross-cutting · **Est:** 1.5
- **Read:** SPEC 17.6, 19.4, and the demo script in the repository README
- **Depends:** T1-01, T1-03, T1-04, T1-05, T1-08, T1-09 · **Gate:** IG-CHAIN
- **Components:** `test/e2e/golden-path.spec.ts`
- **Build:** The full 90-second script as an automated test with a mocked Gemini. A `--repeat 10` mode.
- **Tests:** itself.
- **Done when:** it passes 10 consecutive times and the result is recorded in `state/INTEGRATION_GATES.md`.

---

## Tier 2 — optional (8 person-hours)

Do not start any of these while a T0 or T1 acceptance criterion is failing.

### T2-01 — Mutation sonification
- **Feature:** F-17 · **Est:** 2
- **Read:** SPEC 9.8, 12.9, 5.11
- **Depends:** T1-02, T1-01 · **Gate:** none
- **Components:** `src/content/audio/mutation.ts`
- **Build:** 8-point cap, 70 ms spacing, 0.6 gain factor, 1200 ms rate limit, suppression during scans and batches.
- **Tests:** `test/e2e/mutation-audio.spec.ts` asserts 5 tones after the results injection and at most one burst per 1200 ms on a rapidly-mutating fixture.
- **Done when:** F-17 criteria pass.

### T2-02 — Convex telemetry
- **Feature:** F-18 · **Est:** 3
- **Read:** SPEC 5.14, 14.1
- **Depends:** T1-04 · **Gate:** IG-10, IG-12
- **Components:** `src/sw/telemetry.ts`, `convex/`, `panel/`
- **Build:** One table. Fire-and-forget writes in try/catch, never awaited, 1500 ms abort, 20-record in-memory queue. The subscriber panel. `telemetryEnabled` default false.
- **Tests:** `test/e2e/telemetry-isolation.spec.ts` blocks the Convex route and asserts every other acceptance criterion still passes; `test/unit/telemetry-shape.spec.ts` asserts no URL, no page content, no key.
- **Done when:** F-18 criteria pass and both gates are `PASS`.

### T2-03 — Cohere build-time synonym map
- **Feature:** F-19 · **Est:** 2
- **Read:** SPEC 7.2.3, 13.3, 14.2
- **Depends:** T0-07 · **Gate:** none
- **Components:** `scripts/build-synonyms.ts`, `src/data/`
- **Build:** Build-time script only. `COHERE_API_KEY` never referenced from `src/`. Output bundled as static JSON.
- **Tests:** `test/unit/synonyms.spec.ts` asserts the three named phrases resolve on tier one; a request interceptor asserts zero runtime Cohere requests.
- **Done when:** F-19 criteria pass, including the "improve by at least 2 of 20 or delete it" rule.

### T2-04 — Verbosity toggle
- **Feature:** F-20 · **Est:** 1
- **Read:** SPEC 10.7, 10.6.3, 11.6
- **Depends:** T0-16, T1-06 · **Gate:** none
- **Components:** `src/sw/commands/verbosity.ts`
- **Tests:** `test/unit/verbosity.spec.ts`.
- **Done when:** F-20 criteria pass.

---

## Dependency summary

```
T0-01 ──┬─► T0-02 ──┬─► T0-03 ──┬─► T0-08 ──┬─► T0-10 ──┐
        │           │           │           │           │
        └─► T0-04 ──┤           ├─► T0-09 ──┘           │
                    │           ├─► T0-11 ──────────────┤
                    ├─► T0-06   ├─► T0-12 ──┐           │
                    │           └─► T0-17 ──┤           │
        T0-04 ──────┴─► T0-05 ──┬─► T0-07 ──┴─► T0-13 ──┤
                                ├─► T0-14 ──► T0-15 ────┤
                                │                       │
                                └─► T0-16 ──────────────┴─► T0-19 (IG-CHAIN)
                                                            T0-18 (security)

T0-19 ─► T1-01, T1-02 ─► T1-03
                      ─► T1-04 ─► T1-10
         T1-05, T1-06 ─► T1-07
         T1-08, T1-09 ─► T1-10

T1-* ──► T2-01, T2-02, T2-03, T2-04
```

**Critical path:** T0-01 → T0-02 → T0-03 → T0-05 → T0-07 → T0-13 → T0-15 → T0-19. Everything else can be parallelized around it.
