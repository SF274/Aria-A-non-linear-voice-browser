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

### DEV-009 — Mutation sonification is generative, and the audio engine gained a cue bus
- **SPEC section:** 9.5 (the per-tone graph), 9.6 rule 4 (a failed resume disables audio), 9.8 (mutation sonification).
- **Original requirement:** 9.8's six steps: sonify added entries that are enabled and in the viewport, cap 8, sort y then x, 70 ms spacing, gain × 0.6, suppress during a scan or a batch, one burst per 1200 ms.
- **Why it cannot be met:** it can, and it is, unchanged. HD-10 adds to it.
- **Replacement behaviour:**
  1. **Three layers, not one.** SPEC 9.8's point tones are layer two and are untouched. Layer one is a swell — two detuned sawtooth voices spread in stereo through a resonant lowpass whose cutoff opens over the attack and settles back, plus a sine holding the root — whose depth, length, loudness and brightness all interpolate from how much of the page arrived. Layer three is a flurry of short band-passed clicks for text that changed without adding a control, which SPEC 9.8 does not cover at all because text churn never reaches the element index. All pitches are quantized to an A minor pentatonic set built on the 220 Hz that SPEC 9.3's `freq(y)` is anchored to, and nothing is random: the same mutation always produces the same sound.
  2. **A minimum-magnitude gate.** A burst below `MUTATION_MIN_ADDED_ELEMENTS` (2) added elements and `MUTATION_MIN_TEXT_CHANGES` (2) text changes is not sonified and does not spend the rate limit. Without it the demo page's loading indicator, which replaces the results region 800 ms before the flights land, consumes the 1200 ms window and F-17's five tones never play. A burst that passes the gate but ends up scheduling nothing is likewise not charged for the window.
  3. **A second observer.** The index observer (SPEC 12.9) does not watch `characterData`, so a text-only change never fires it. The sonifier keeps its own observer for `childList` + `characterData` that only counts — no layout read, no query, no per-node allocation beyond a sample of eight, and it stops counting past 256 records. Every layout read happens at flush time, which the rate limit holds to once per 1200 ms. An index change carrying additions flushes immediately; everything else waits out a 220 ms trailing throttle, which is longer than the index observer's 150 ms debounce so that a structural change wins over the churn that preceded it.
  4. **A shared cue bus.** SPEC 9.5's graph ends at `AudioContext.destination` per tone. Every cue now ends at `masterGain -> limiter -> destination` instead. This is what mutes the channel for `settings.audioEnabled` in one place, and what stops a swell plus eight overlapping point tones from clipping the output — the same problem, and the same fix, as `TTS_LIMITER`. The TTS path is untouched and stays separate (SPEC 9.1).
  5. **SPEC 9.6 rule 4 now applies only to a resume inside a user gesture.** The rule takes a failed `resume()` as proof that audio is unavailable for the page. That inference is only valid inside a gesture. Mutation sonification fires whenever the page changes, usually before the user has touched anything, so its resume is *expected* to be refused; letting it set the flag would silence the hold-to-talk tones that come afterwards. The ambient path now resumes quietly and gives up on that burst only.
- **Consequence:** F-17's three criteria are asserted in `test/e2e/mutation-audio.spec.ts` against real Web Audio (measured: first tone 158–184 ms after injection, exactly 70 ms spacing, 3 bursts in 3 s of 20 Hz mutation). SPEC 9.6 rule 4's spoken "Audio cues need a click on the page first." is still not built; T1-02 is not `DONE`. **Nobody has listened to any of this yet** — every assertion is about what was scheduled, not about what it sounds like.
- **Date:** 2026-09-19
- **Status:** ACTIVE

### DEV-010 — Spoken answers are panned; SPEC 9.1's "speech cannot be panned" is now engine-dependent
- **SPEC section:** 9.1 (the two-channel table: speech is "No. Always centre", with a `[FACT]` that no specification lets speech synthesis be captured into a Web Audio graph), 5.13 (`Settings`), 9.8 (mutation sonification, now default-off).
- **Original requirement:** speech is never positioned; only non-speech tones are.
- **Why it cannot be met as written:** the `[FACT]` was written against `chrome.tts` and is still exactly right for it. HD-07 then made ElevenLabs the primary engine, and that path does not synthesize in the browser at all — it fetches an MP3 and the content script decodes it with `decodeAudioData` into an `AudioBufferSourceNode`. The audio is already inside a Web Audio graph before it is heard, so the barrier SPEC 9.1 describes is not present on that path. The blanket sentence is true of the engine SPEC 9.1 knew about and false of the one the project now ships.
- **Replacement behaviour:**
  1. `SpeakOptions.pan` and `speakFromSettings(text, onDone, atX)`. `atX` is the document-relative x of whatever the sentence is about; the service worker converts it with SPEC 9.3's `pan(x)` and forwards it in the `tts.play` payload. The content script inserts a `StereoPannerNode` **after** the limiter, so the limiter still sees the whole signal and only decides level — panning before it would let a hard-left clip duck a hard-right one. A pan of 0 builds no node at all.
  2. `pan(x)` moved to `src/shared/spatial.ts` and is re-exported by `audio/mapping.ts`. Two copies of that formula is how the voice and the tone describing the same element end up in different places.
  3. Honoured only when `settings.spatialLinks` is true (default true) **and** the ElevenLabs path is in use. On `chrome.tts` the request is ignored rather than faked; SPEC 9.1's boundary is unchanged there and a unit test pins it.
  4. An utterance that is not about one element — a summary, the clock, a failure sentence — passes no `atX` and stays centre. `undefined`, not 0: 0 is the far left of the page.
  5. `settings.mutationAudio` (default **false**) gates F-17. The engine, the sonifier and all their tests stay; the observer never attaches unless the setting is on, so an un-sonified page pays nothing. The e2e suite turns it on through a `window.__ECHO_AUDIO__.startMutationAudio()` hook rather than by writing extension storage.
- **Consequence:** F-17 is built and tested but **off by default**, so it is no longer part of the shipped experience unless someone enables it — the human listened to it and did not want it. Spatial links are unmeasured by ear, like everything else in the audio layer. `test/unit/spatial-links.spec.ts` covers the pan values, the toggle, the default, and the chrome.tts boundary.
- **Date:** 2026-09-20
- **Status:** ACTIVE

### DEV-011 — A second network service on the answer path, and a fifth prompt part
- **SPEC section:** 19.3 (the golden path may not depend on the network), 8.2 (the parts of the answer prompt), 8.5 (page-derived data is inert), 5.13 (`Settings`), 11.6 / 11.7 (summary and Q&A).
- **Original requirement:** the answer path calls exactly one external service, Gemini, and its prompt has three user parts — request, browser context, page text.
- **Why it changes:** HD-13. The product's user cannot see the page, so every visual signal that a page is untrustworthy is unavailable to them, and the assistant's own voice launders synthetic text into something that sounds authoritative. No amount of local analysis reproduces a trained detector's judgement, so the signal has to come from outside.
- **Replacement behaviour:**
  1. `src/sw/gptzero/client.ts` and `detect.ts`, in the service worker. Key in the `x-api-key` header, never the URL (SPEC 8.6's rule, applied to the second key exactly as to the first). **No retry on any status** — unlike the Gemini client, which retries a 5xx once. The detector is advisory and the user is waiting in silence; a retry would spend their time on a warning they may not even need.
  2. A fourth user part, `<content_authenticity>`, between the browser context and the page text. Untrusted page text stays last, after every trusted framing part. `sanitizeForPrompt` now strips `content_authenticity` delimiters too, so a page cannot write the tag into its own text and forge a clean verdict — `qa-inert.spec.ts` and `gptzero.spec.ts` both pin this.
  3. **The spoken warning is composed in code, not by the model.** The prompt is told a warning has already been given so it does not repeat it, but a model that ignores its instructions must not be able to swallow a safety notice. What the model is asked to do instead is the part a fixed sentence cannot: attribute the page's claims to the page rather than stating them as fact.
  4. The call is started before `gatherBrowserContext` and awaited after it, so on the common path it costs no wall-clock time at all. Its own budget is `GPTZERO_TIMEOUT_MS` (2500 ms), independent of the answer call's 8000 ms.
  5. Three bands, not two: `high` at P(ai) ≥ 0.80 or `AI_ONLY`; `mixed` at ≥ 0.50, or ≥ 0.35 when GPTZero itself classes the document `MIXED` (a whole-document probability understates machine-written passages inserted into human text); `clean` below, which says nothing. Text under `GPTZERO_MIN_CHARS` (350) gets no verdict at all — detectors are unreliable on short text, and a false warning on a page of nav links teaches the user to ignore the warning that matters.
  6. Verdicts are cached by a hash of the sampled text, 50 entries, so the second question about a page costs nothing. Only a real verdict is cached; a failure is retried next time.
- **Consequence:** the answer path now touches two services instead of one. It degrades to the previous behaviour on every failure, which `test/unit/gptzero.spec.ts` asserts one failure mode at a time (no key, disabled, short text, network error, 403, 429, 500, timeout, garbage body). **The thresholds have not been calibrated against real pages** — they are reasoned defaults, and nobody has yet checked what fraction of ordinary human-written pages GPTZero scores above 0.5. That is the open risk in this feature, and it is a false-positive risk, not a false-negative one.
- **Date:** 2026-09-20
- **Status:** ACTIVE

### DEV-012 — Page text reaches the classifier with its paragraph breaks, and the prompt now quotes page text
- **SPEC section:** 8.4 (sanitization collapses all whitespace), 8.2 (the parts of the answer prompt), 11.6 step 2 (`page.text`), 5.13 (`Settings`). Extends DEV-011.
- **Original requirement:** every page-derived string entering a prompt has all whitespace runs collapsed to single spaces, and the answer prompt's framing parts contain no page text.
- **Why it changes:** HD-14. Two things follow from scoring paragraphs instead of pages, and both push against SPEC 8.4 as written.
- **Replacement behaviour:**
  1. **`sanitizeForPromptKeepingBreaks`**, used only on the path that feeds the classifier. GPTZero segments paragraphs on blank lines; text that has been through `sanitizeForPrompt` arrives as one undifferentiated blob and comes back as a single paragraph, so per-paragraph detection would have had nothing to work with. Every other SPEC 8.4 rule is unchanged — control characters stripped (bar `
`), horizontal whitespace collapsed, tag delimiters removed — and runs of blank lines are capped at one so a spacer-heavy page cannot pad the sample. **The answer prompt is not affected**: `buildAnswerRequestBody` re-sanitizes with the collapsing version, so what Gemini sees is byte-identical to before. `extractPageText`'s default is unchanged and the option is opt-in, so the one existing caller had to ask for it.
  2. **Quoted excerpts in `<content_authenticity>`.** The block used to contain nothing but numbers. It now carries the opening words of each flagged paragraph, because naming the section is the whole point of paragraph-level detection — "the part about baggage fees" is actionable in a way that "some of this page" is not. The excerpts are `sanitizeForPrompt`'d, capped at `GPTZERO_EXCERPT_MAX_CHARS` (120), limited to `GPTZERO_MAX_EXCERPTS` (4), and the block tells the model in-line that they are page text and never instructions. A test drives a `</content_authenticity>`-bearing paragraph through the whole path and asserts the block still has exactly one closing delimiter.
  3. **Three-tier paragraph extraction**, because the response shape is still unobserved: `paragraphs[]` when present and plural; sentence runs accumulated to `GPTZERO_PARAGRAPH_MIN_CHARS` when there is no paragraph array **or** when a long sample came back as a single paragraph (which is what a collapsed page looks like); document score alone when neither array is there.
  4. **Level promotion.** A document scoring `clean` is raised to `mixed` when at least `GPTZERO_MIN_FLAGGED_PARAGRAPHS` paragraphs are flagged. This is the change that makes a one-section insert audible, and it is the only way a verdict's level can disagree with its own `aiProbability`.
  5. **`GPT_ZERO` and `pnpm gate:gptzero`.** A script-only environment variable, `COHERE_API_KEY`'s existing arrangement. The gate classifies a machine-written sample, a human-written one (the false-positive check) and a human article with one machine section spliced in (the HD-14 case), then prints the response's field names, every section's score, and the verdict our parser produces. It exists because the success response shape has never been observed and the thresholds have never met a real page.
- **Consequence:** the spoken warning now distinguishes "most of this page" from "one section of this page", which is a distinction the user cannot make for themselves by skimming. **Still unverified:** nobody has run `pnpm gate:gptzero` with a real key, so the response shape, the tier that actually fires, and the false-positive rate on human prose all remain unobserved. That gate is the one thing standing between this feature and being trustworthy.
- **Date:** 2026-09-20
- **Status:** ACTIVE

## Superseded

*(none yet)*

### DEV-012 — `check` and `uncheck` write the state instead of clicking (SPEC 7.6.3 step 6)
- **SPEC section:** 7.6.3 step 6 (`check -> if !checked, element.click()`, `uncheck -> if checked, element.click()`).
- **Original requirement:** guard on the current state, then click.
- **Why it cannot be met as implemented:** a click is relative. It toggles whatever state the element is in at the moment it lands, so the guard only holds if the element's state cannot change or be misread between the guard and the click. Two ordinary pages break that: a React-controlled checkbox, whose rendered state can disagree with the DOM's, and any page whose click handler calls `preventDefault()` — the canceled-activation behaviour restores the previous checkedness, so the click silently does nothing at all. The user is operating with the screen off and cannot see either failure.
- **Replacement behaviour:** `check`/`uncheck` read the state first and return success unchanged when it already matches. Otherwise the state is *written* through the native `checked` setter found on the prototype chain, then `input` and `change` are dispatched with `bubbles: true` — the same tracker bypass as DEV-004, now shared in `nativePropertySetter` / `dispatchInputAndChange`. An element with no `checked` property (a custom `role="switch"`) is still clicked, since its state lives in the page's script; `aria-checked` is read first so that click is never blind. HD-14.
- **Consequence:** a `click` listener on a native checkbox no longer fires for `check`/`uncheck` — `input` and `change` do, which is what form state and every framework listen for. A page that drives its checkbox logic from `onclick` alone would not see the toggle; `click` (the verb) is unchanged and still available for one. SPEC 7.6.2 is untouched, and the `[REQUIREMENT]` forbidding synthesized `MouseEvent` coordinates is honoured — nothing here dispatches a mouse event.
- **Date:** 2026-09-20
- **Status:** ACTIVE
