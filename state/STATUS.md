# state/STATUS.md

**Authority:** rank 5 in `CLAUDE.md` section 4. This file describes the build; it never defines it.
**Owner:** the coding agent(s). Update at the end of every task, successful or not.
**Multi-agent note:** two agents (`claude`, `gemini`) may be working this repo concurrently. Ownership per task is in the tables below and is authoritative per `AGENT_SPLIT.md`. Claim a task by editing its row to `IN_PROGRESS` with your identity in the note, and push that claim before writing any code — see `AGENT_SPLIT.md` section 4.

---

## Run metadata

| Field | Value |
| --- | --- |
| `startedAt` | 2026-09-19T13:08:58Z |
| Integration freeze | `startedAt` + planned duration − 12 h *(set explicitly once known)* |
| Feature freeze | submission deadline − 3 h *(set explicitly once known)* |
| Hard stop | submission deadline − 2 h *(set explicitly once known)* |
| Current phase | `T0` |
| Last session ended | — |

Phases: `NOT_STARTED` → `T0` → `T1` → `T2` → `STABILIZING` → `DEMO_READY`.

---

## Progress

| Tier | Total | DONE | IN_PROGRESS | BLOCKED | TODO |
| --- | --- | --- | --- | --- | --- |
| T0 | 19 | 17 | 0 | 0 | 2 |
| T1 | 10 | 1 | 0 | 0 | 9 |
| T2 | 4 | 0 | 0 | 0 | 4 |

---

## Task states

Legend: `TODO` · `IN_PROGRESS` · `DONE` · `BLOCKED`

`DONE` requires `pnpm verify` green **and** every acceptance criterion in `SPEC.md` section 16 for that feature passing, checked one by one.

### Tier 0
| Task | Owner | State | Note |
| --- | --- | --- | --- |
| T0-01 Repo scaffold | claude (solo) | DONE | completed 2026-09-19T13:21:39Z; pnpm verify green. See N-001: F-01's full SPEC 16 criteria still need T0-02/T0-03. |
| T0-02 Shared contracts | claude (solo) | DONE | completed 2026-09-19T13:38:06Z (built on Opus per AGENT_SPLIT.md 3); pnpm verify green, 101 new tests, all 24 SPEC 5 schemas covered. See DEV-001, N-005, N-006. |
| T0-03 Manifest and shells | claude (solo) | DONE | completed 2026-09-19T14:04:00Z; pnpm verify green, extension loads with zero console errors, content script announces readiness on demo page, F-01 criteria fully met. See N-008. |
| T0-04 Demo page static | gemini | DONE | completed 2026-09-19T13:49:30Z; pnpm verify green, all 7 e2e tests passing, axe-core reports 0 serious/critical violations, F-16a criteria fully met |
| T0-05 Element index | claude | DONE | completed 2026-09-19T14:26:00Z; pnpm verify green, all 20 DOM tests and 4 observer tests pass, IG-05 PASS (80.77 ms / 22.53 KB for 120 elements; 16.30 ms on demo page), F-04 criteria fully met. |
| T0-06 Normalization | claude | DONE | completed 2026-09-19T15:34:00Z; pnpm verify green, normalizeTranscript and cleanText covered by 31 tests in test/unit/normalize.spec.ts, F-05 normalization criterion passing. |
| T0-07 Local resolver | gemini | DONE | completed 2026-09-19T15:47:32Z; pnpm verify green (167 Vitest + 10 Playwright e2e), IG-07 PASS (16/20 = 80.0%), F-05 criteria fully met (exact download ambiguity, sandwich miss, disabled elements never win). |
| T0-08 Session state machine | claude | DONE | completed 2026-09-19T16:47:07Z; pnpm verify green (250 unit/dom/perf tests + 13 e2e), full state machine with persistence in chrome.storage.session, 15s watchdog, 3s transcribing timeout, 15s clarify timeout, cancellation on KEY_DOWN. |
| T0-09 Mic permission | claude | DONE | completed 2026-09-19T16:47:07Z; pnpm verify green, tab-based permission grant flow in src/pages/permission.html, micGranted in storage.local, mic.html iframe fallback web-accessible, ensureMicPermission tested. |
| T0-10 Speech recognition | claude | DONE | completed 2026-09-19T16:47:07Z; pnpm verify green, offscreen document host in src/offscreen/, Web Speech API SpeechRecognition lifecycle with fresh instance per utterance, interim/final results, error mapping per SPEC 10.5. |
| T0-11 Hold-to-talk | claude | DONE | completed 2026-09-19T16:47:07Z; pnpm verify green, window capture keydown/keyup matching holdKey, editable target guard for input/textarea/select/contenteditable, listenStart/listenEnd tones, 250ms tap discard. |
| T0-12 Options page | gemini | DONE | completed 2026-09-19T14:43:00Z; pnpm verify green, 8 unit/DOM tests passing, e2e options test passing (persists API key, no leaks, gate buttons functional), F-21 criteria fully met. |
| T0-13 Gemini client | gemini | DONE | completed 2026-09-19T19:18:00Z; pnpm verify green (271 Vitest + 13 Playwright e2e), prompts.ts compiled constant, client.ts x-goog-api-key header security & timeout/retry handling, resolver.ts schema validation & error recovery, 9 fixtures in test/fixtures/gemini/, F-06 criteria fully met. |
| T0-14 Action validation | gemini | DONE | completed 2026-09-19T16:08:30Z; pnpm verify green, all 9 rules from 7.6.1 unit tested, 7.6.2 verb-role table enforced with batch abort. |
| T0-15 Executor | gemini | DONE | completed 2026-09-19T16:08:30Z; pnpm verify green (199 Vitest + 13 Playwright e2e), all 7 verbs verified, bubbles: true on input/change, 12.8 re-resolution + 0.15 movement threshold, stale target batch abort, F-07 criteria fully met. |
| T0-16 TTS service | gemini | DONE | completed 2026-09-19T20:16:19Z; pnpm verify green (300 Vitest + 13 Playwright e2e), dual-engine TTS (ElevenLabs Flash v2.5 + chrome.tts fallback, HD-A06/HD-07), AudioContext routing to content script, 40-char truncation, exact templates per SPEC 10.6.3, interruption on key.down. |
| T0-17 Highlight overlay | gemini | DONE | completed 2026-09-19T14:47:00Z; pnpm verify green, 7 DOM tests passing, inline styles verified byte-identical before/during/after, F-09 criteria fully met. |
| T0-18 Security tests | claude | TODO | not deferrable past the integration freeze |
| T0-19 Chain harness | claude | TODO | |

### Tier 1
| Task | Owner | State | Note |
| --- | --- | --- | --- |
| T1-01 Demo page dynamics | gemini | TODO | |
| T1-02 Audio engine | claude | TODO | |
| T1-03 Scan with sync highlight | claude | TODO | sync is mandatory |
| T1-04 Confidence gate and clarification | claude | TODO | |
| T1-05 Sequences | claude | TODO | enables the primary demo |
| T1-06 Summary and cache | gemini (built by claude on human instruction) | IN_PROGRESS | HD-09 / DEV-008. Built: `page.text` extraction (`src/content/page-text.ts`), the summary path ("summarize", "what's on this page", "where am I"), sanitization, tests (`test/dom/page-text.spec.ts`, QA suite G). **Not built:** the 50-entry LRU summary cache, the pre-seeded demo summary, `summary-cache.spec.ts` and `summary-offline.spec.ts` — F-13's offline and eviction criteria are unmet. |
| T1-07 Q&A | gemini (built by claude on human instruction) | IN_PROGRESS | HD-09 / DEV-008. Built: `src/sw/gemini/qa.ts` (own prompt, plain text, spoken only), interrogative routing (`src/sw/commands/ask.ts`), `qa-inert.spec.ts` (a JSON action array is spoken verbatim and cannot be executed), QA suite G. Depends on T1-06, which is not `DONE`. The "capital of France" and "what airline is this" criteria are covered only against a stubbed model; live-model behaviour is unmeasured. |
| T1-08 Tabs, search, bookmark | gemini (built by claude on human instruction) | DONE | completed 2026-09-19; pnpm verify green. `src/sw/commands/browser.ts` + the SPEC 6.18 intercept in `pipeline.ts`. F-15 criteria checked one by one: every 6.18 row acts (unit tests over a mocked `chrome.tabs`, plus QA F1/F3 driving a real browser: search, Keep, switch/next/previous tab, new/close tab, reload, back, forward); "search for waterloo" opens `SEARCH_TEMPLATE` with the query encoded (F1); "go back" with no history speaks "There's nothing to go back to." (F3); a Gemini spy shows zero model calls for all of them (F1, F3, and a fetch spy in the unit tests). Save is Google Keep, not a bookmark — HD-08 / DEV-006.
| T1-09 Blackout overlay | claude | TODO | |
| T1-10 Golden path test | claude | TODO | |

### Tier 2
| Task | Owner | State | Note |
| --- | --- | --- | --- |
| T2-01 Mutation sonification | unclaimed | TODO | build first in T2 |
| T2-02 Convex telemetry | gemini | TODO | gated on HD-02 |
| T2-03 Cohere synonyms | gemini | TODO | gated on HD-02 |
| T2-04 Verbosity toggle | gemini | TODO | |

---

## Active work
- **Page understanding, tabs, date/time, IG-03 (human-directed, 2026-09-19; HD-09, DEV-008, NOTES N-017).** The assistant can now summarize a page, answer questions about it, answer about another tab in the same window, read out the date, time and open tabs without a model, and run "click X and tell me where it leads". Both prompts get the current date and time in a separate context part; the resolver gets the page title but no address and no tab list. IG-03's options button is silent and reports PASS or FAIL only. T1-06 and T1-07 are `IN_PROGRESS`, not `DONE` (no summary cache or seeded demo summary; live-model behaviour unmeasured). `pnpm verify` green on 2026-09-19 (554 Vitest, perf, 53 Playwright including QA suite G). Nothing else in the tables changed.
- **Tier 1 global commands and Phase 1 stragglers (human-directed, 2026-09-19).** T1-08 is `DONE` (above). Two fixes shipped with it: `hold-to-talk.ts` now reads `settings.holdKey` (the options page always wrote it there; the old top-level read meant a changed hold key never applied), and the spoken sentence for a model HTTP 429 no longer reads "rate limited" aloud (DEV-007). Execution ticks are in: one SPEC 9.3 positional tick per sequence step, plus a quiet "still working" click while the model is being waited on. **That is not T1-02**, which stays `TODO`: the audio engine proper (`src/content/audio.ts`, the F-10 scan, clarify ticks, mutation sonification) is unbuilt. T1-04 and T1-05 also stay `TODO` — the clarification and sequence paths run and are covered by QA suites C/E, but their own acceptance tests (`test/e2e/clarify.spec.ts`, `test/e2e/sequence.spec.ts`) do not exist. See NOTES N-016, DEVIATIONS DEV-006 / DEV-007, HUMAN_DECISIONS HD-08.
- **Independent true-audio QA pass (human-directed, not a numbered task).** Added `test/e2e/qa-exhaustive.spec.ts` (+ `support/qa-harness.ts`, `scripts/generate-test-audio.ts`, `test/fixtures/audio/`), and built the service-worker pipeline that was missing between `stt.result` and the spoken confirmation (`src/sw/pipeline.ts`, `src/sw/resolver/clarify.ts`; DEV-005). Defects found and fixed are listed in `NOTES.md` N-015; deviations in `DEVIATIONS.md` DEV-003 to DEV-005; environment findings in N-014. **No task state above was changed:** T0-19 stays `TODO` (IG-CHAIN needs 10 consecutive passes recorded), T1-04 / T1-05 stay `TODO` (audio ticks and the stale-`buildId` re-fetch are not built).

## Blocked work
*(none)*

---

## Completion check — `SPEC.md` 19.4

| # | Condition | Met |
| --- | --- | --- |
| 1 | Every T0 and T1 acceptance criterion passes | ☐ |
| 2 | `IG-CHAIN` passes 10 consecutive times | ☐ |
| 3 | `golden-path.spec.ts` passes 10 consecutive times | ☐ |
| 4 | Golden path runs with the network disabled, degrading only as specified | ☐ |
| 5 | No gate blocking a T0 or T1 feature is `BLOCKED` | ☐ |

The project is not complete until all five are checked.
