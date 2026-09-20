# state/DEVIATIONS.md

**Purpose:** every departure from `SPEC.md`, with enough detail that a future session understands what changed and what it cost.
**Rule:** all five fields, always. A deviation without the consequence field is incomplete, because the consequence is the part a future reader needs.
**Rule:** never delete an entry. Mark it superseded.

Format:

```
### DEV-00n — <one line>
- **SPEC section:**
- **Original requirement:**
- **Why it cannot be met:** (reference the ERRORS.md entry or gate ID)
- **Replacement behaviour:**
- **Consequence:** what this costs, what tests changed, what a future session must know
- **Date:**
- **Status:** ACTIVE | SUPERSEDED by DEV-00m
```

A deviation is required for any of the following, no matter how small it seems:

- Implementing something differently from how SPEC describes it.
- Skipping an acceptance criterion.
- Changing a constant that SPEC names explicitly.
- Falling back to a path SPEC lists as a fallback (the fallback is specified, but the fact that you took it is not).
- Changing a contract in `SPEC.md` section 5.

A deviation is **not** permitted for anything on the `CUT` or `FORBIDDEN` list. That is a `HUMAN_DECISIONS.md` escalation.

---

## Active deviations

### DEV-001 — T0-02's `Read` field in TASKS.md omits two SPEC sections its own `Build` field requires
- **SPEC section:** SPEC 7.2.4, 9.3, 9.7, 11.4, 12.2 (via `TASKS.md`, T0-02).
- **Original requirement:** `TASKS.md` T0-02's `Read` field lists "SPEC 5 (all), 7.2.4, 9.3, 11.5"; its own `Build` field requires implementing "every tunable constant from SPEC 7.2.4, 9.3, **9.7**, **11.4**, 12.2" — the `Read` field omits 9.7 and 12.2 entirely, and cites 11.5 (a latency-target table with no tunables) where the actual constants named in `Build` live in 11.4.
- **Why it cannot be met:** `TASKS.md` is read-only per this session's operating instructions (any correction is a `DEVIATIONS.md` or `HUMAN_DECISIONS.md` entry, never a direct edit); this is an internal inconsistency between two fields of one `TASKS.md` task, not a SPEC conflict, so no `HUMAN_DECISIONS.md` question is warranted — the correct source section for each constant is unambiguous by reading SPEC itself.
- **Replacement behaviour:** `src/shared/contracts.ts` and `src/shared/constants.ts` were implemented against the `Build` field's section list (7.2.4, 9.3, 9.7, 11.4, 12.2), read in full alongside SPEC 5 (all), as `Build` is the field that actually enumerates what the task produces. 11.5 was also read for context (it is short and adjacent) but contributed no constants, as expected.
- **Consequence:** none functional — every constant in `constants.ts` is directly traceable to a real SPEC citation, independently checked against SPEC.md while reviewing this task. A future session reading T0-02's `Read` field in isolation should not assume it is the complete list; `Build` is authoritative for this task.
- **Date:** 2026-09-19
- **Status:** ACTIVE

### DEV-003 — Re-resolution applies the 0.15 movement limit to a lone match too (SPEC 12.8 step 3 vs 12.10)
- **SPEC section:** 12.8 step 3 ("if exactly one -> use it") and 12.10 ("Element moved more than 0.15 normalized units: treat as not_found").
- **Original requirement:** the two sections disagree for a single match. 12.8 only applies the 0.15 limit when choosing among several matches; 12.10 says any element that moved more than 0.15 is not found.
- **Why it cannot be met:** both cannot hold. The true-audio QA suite (B1, `test/e2e/qa-exhaustive.spec.ts`) moves the only "Confirm booking" button 0.6 units during a sequence's step delay; with 12.8 read literally the executor clicks it anyway.
- **Replacement behaviour:** 12.10 wins, because it is the safety rule ("acting on a moved element is how a voice interface clicks the wrong thing"). `reResolveElement` returns null for a single match more than `MAX_MOVEMENT_DISTANCE` from its indexed position. Unit-tested in `test/dom/executor.spec.ts`.
- **Consequence:** a page whose document height changes between resolve and execute (results loading above the target) can now abort a batch that 12.8 alone would have run, because coordinates are normalized by document height. That is the safe direction for a demo; see NOTES N-014.
- **Date:** 2026-09-19
- **Status:** ACTIVE

### DEV-004 — `fill` writes through the native value setter only, and the field is blurred afterwards (SPEC 7.6.3 step 6)
- **SPEC section:** 7.6.3 step 6 (`fill -> focus, set .value, dispatch input and change`) and the [REQUIREMENT] that fill must notify React/Vue.
- **Original requirement:** set `.value`, dispatch `input` and `change`.
- **Why it cannot be met as implemented:** the previous executor wrote the value twice (native prototype setter, then the instance property). React shadows `value` on the instance to track it; the second write updates that tracker, so the following `input` event looks like "no change" and the fill is dropped. Separately, leaving the filled field focused makes the next hold-to-talk keypress land in a text field, where SPEC 6.1 (correctly) refuses to intercept it: after any voice fill the user could not talk again without clicking away.
- **Replacement behaviour:** the value is written once through the native setter found on the prototype chain, `input` and `change` are dispatched as before, then the element is blurred. Covered by `test/dom/executor.spec.ts` (React-style tracker) and QA tests A2 and C6 (C6 fails without the blur: the filled field keeps focus and the next Space press never reaches the service worker).
- **Consequence:** frameworks that commit on blur now also see the blur. No behaviour SPEC names is removed.
- **Date:** 2026-09-19
- **Status:** ACTIVE

### DEV-005 — The service worker orchestration (stt.result to spoken confirmation) is built outside a numbered task
- **SPEC section:** 4.5, 6.4-6.12, 7.4-7.7 via TASKS T0-19 / T1-04 / T1-05.
- **Original requirement:** `src/sw/index.ts` carried `TODO (T0-13): pass to resolver pipeline` at both `stt.result` and `test.transcript`; no task owns the wiring, and T0-19 (chain harness) assumes it exists.
- **Why it cannot be met:** the chain cannot be verified end to end while nothing connects the finished resolver, executor and TTS modules; every "DONE" module was tested in isolation only.
- **Replacement behaviour:** `src/sw/pipeline.ts` (orchestration), `src/sw/resolver/clarify.ts` (SPEC 7.5), `ui.highlight` in the content script, TTS completion callbacks. Requested explicitly by the human as part of the autonomous QA remediation loop. T1-04 and T1-05 acceptance is not claimed by this: audio ticks, the 15 s expiry edge cases beyond E2-E4, and the re-fetch-and-retry on a stale `buildId` (SPEC 12.10) are not implemented.
- **Consequence:** T0-19 and the F-11 / F-12 criteria can now be exercised; STATUS.md is deliberately not changed by this entry.
- **Date:** 2026-09-19
- **Status:** ACTIVE

### DEV-006 — "Save this page" opens Google Keep instead of creating a bookmark (SPEC 6.18)
- **SPEC section:** 6.18, "save this page" / "bookmark this" row: `chrome.bookmarks.create({ title, url })`; F-15 criteria in SPEC 16.
- **Original requirement:** bookmark the current page.
- **Why it cannot be met:** HD-08 (a human directive, rank 1) replaces it with a Google Keep note.
- **Replacement behaviour:** `src/sw/commands/browser.ts` opens `KEEP_NOTE_TEMPLATE` (compile-time constant in `constants.ts`, like `SEARCH_TEMPLATE`) with the tab's title and URL, percent-encoded, and speaks "Opening Keep with this page." "Bookmark this" still routes to the same command. HD-08's "switch to <name> tab" is added alongside every SPEC 6.18 row (new / close / next / previous tab, go back / forward, reload, search).
- **Consequence:** (1) the note is only pre-filled if Keep honours the `#NOTE/?text=` fragment; ECHO cannot see into Keep, so the sentence claims only that Keep was opened. When the browser is not signed in to Google, Keep redirects to sign-in (observed in the QA suite; the fragment survives the redirect). (2) Opening Keep is a network dependency, but not on the primary demo flow (SPEC 19.3). (3) The `bookmarks` permission is now unused; removing it is a manifest change left to a human.
- **Date:** 2026-09-19
- **Status:** ACTIVE

### DEV-007 — The spoken sentence for HTTP 429 no longer says "rate limited" (SPEC 11.4 rule 1)
- **SPEC section:** 11.4 rule 1: `429 -> "The model is rate limited." Do not retry.`
- **Original requirement:** speak "The model is rate limited."
- **Why it cannot be met:** the human reported that the computer "sometimes reads out rate limit" and asked for it to be fixed. The sentence reads an HTTP status aloud and gives the user nothing to do.
- **Replacement behaviour:** `MODEL_BUSY_SPOKEN_MESSAGE` = "I'm busy right now. Try again in a moment." (`constants.ts`). The behaviour is unchanged: no retry, local candidates are still clarified, the failure is still logged (the pipeline now logs the model tier's error code on every MISS/ERROR, SPEC 6.19). Global commands (DEV-006, SPEC 6.18) never reach the model, which also removes those commands from the free-tier request budget.
- **Consequence:** QA test D5 asserts the new sentence.
- **Date:** 2026-09-19
- **Status:** ACTIVE

### DEV-008 — Page summary and Q&A: what was built and where it departs from SPEC 8.2, 11.4, 11.6, 11.7
- **SPEC section:** 8.2 (two user parts, a fixed system instruction), 11.4 rule 2 (2500 ms timeout), 11.6 (summary cache and pre-seeded demo summary), 11.7 (local resolver first for every interrogative).
- **Original requirement:** as listed; HD-09 asks for the feature itself.
- **Replacement behaviour:**
  1. **Third prompt part.** The resolver request carries `<browser_context>{now, page, justNavigatedFrom?}</browser_context>` after the command and the elements; the answer request carries `<user_request>`, `<browser_context>` (with the window's tabs) and `<page_text>`. The system instruction stays a compiled constant with no page-derived string and no date (SPEC 8.2's intent). `sanitizeForPrompt` now also strips these three delimiters. Tab titles and hostnames are page-derived and travel only in the context part; a hostname, never a path or query, is sent (SPEC 8.3).
  2. **Timeout.** The answer call uses `QA_TIMEOUT_MS` = 8000 ms. SPEC 11.4's 2500 ms is written for the resolver, whose request is a few KB; this request carries up to 30 000 characters and returns prose. Still no retry on timeout, still no retry on 429.
  3. **Local resolver first only for short questions.** SPEC 11.7 offers every interrogative to the local resolver before Q&A. "Where is the submit button" would then click Submit. A question of more than three words goes straight to Q&A; up to three ("what's new", "how it works") is tried locally first, so a link with that name still works. The rule leans toward the answer because a wrong action is worse than a wrong answer (SPEC 7.4).
  4. **Answered without the model:** the date, the time, "how many tabs", "what tabs are open" and "what page am I on" are answered from `chrome.tabs` and the clock (`src/sw/commands/local-answers.ts`). They work offline, on pages the extension cannot read, and cannot be mis-paraphrased.
  5. **Compound commands** ("click the first link and tell me where it leads", "switch to the airport tab and summarize it"): the action runs through the normal path, then the question is answered about the page it led to. This has no SPEC row; it is a composition of two SPEC paths.
  6. **"Switch to Wikipedia" / "switch to the airport page"** (no word "tab") is a tab switch only when an open tab other than the current one matches; otherwise it is a page command.
  7. **Summary cache and the pre-seeded demo summary (SPEC 11.6 steps 1 and 5, F-13's offline and eviction criteria) are not built.** T1-06 is therefore `IN_PROGRESS`, not `DONE`.
  8. A click whose navigation closes the message channel before the executor replies is treated as success when the tab is loading or its URL changed, instead of "I can't read this page."
- **Consequence:** F-14's "cannot emit an Action" criterion is a test (`qa-inert.spec.ts`). Live-model behaviour (word limits, "not on the page" answers, the improved resolver prompt) is unmeasured; the tests stub Gemini.
- **Date:** 2026-09-19
- **Status:** ACTIVE

## Superseded

*(none yet)*
