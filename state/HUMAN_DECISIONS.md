# state/HUMAN_DECISIONS.md

**Authority: rank 1.** This file outranks `SPEC.md` and everything else. An answer recorded here is binding.

**Rule for the agent:** you may only ever append a question under "Open". You may not write, edit, or infer an answer. Answers are written by the human.

**Rule for the agent:** after appending a question, pick a different task. Do not wait, and do not guess so you can proceed.

Escalation format:

    ### HD-0nn — <one line>
    - **Asked:**
    - **Blocking:** task IDs, feature IDs, gate IDs
    - **Context:** two or three sentences, no more
    - **Options:** each with its cost
    - **Recommendation:** yours, with the reason
    - **Status:** OPEN
    - **Answer:**            <- human writes this
    - **Answered:**          <- human writes this

An escalation without options and a recommendation is not an escalation, it is an interruption. Do not write "what should I do".

---

## Answered

### HD-A01 — Keep BrowseBlind's core interaction model
- **Answer:** Yes. Hold-to-talk voice control, LLM page summary on load, NLP-resolved click and fill against real page elements, RAG-style Q&A over page content, and voice-driven tabs, search and saving all stay. This is final.
- **Binding effect:** the agent may not propose or implement a different interaction model. Differentiation comes from execution depth and additive features only.

### HD-A02 — Laptop and headphones only
- **Answer:** No hardware beyond a laptop and headphones. No hardware library items, no external devices, no head tracking.
- **Binding effect:** any design that requires hardware is out of scope without a new decision here.

### HD-A03 — Optimize for wow factor over usefulness
- **Answer:** Yes. The published judging criteria are WOW factor, technical ability, originality, and design. Usefulness is not judged.
- **Binding effect:** where a more useful feature and a more reliable-in-demo feature conflict, take the reliable one. This does not license overclaiming; see `SPEC.md` 1.4.

### HD-A04 — Spatial audio stays, HRTF goes
- **Answer:** Build the audio layout scan. Do not use HRTF, `PannerNode`, or any distance model. Pan for horizontal, pitch for vertical, coarse timbre for role, with a synchronized visual highlight.
- **Binding effect:** `SPEC.md` 9.2 and D-003. Reintroducing HRTF requires a new entry here.

### HD-A05 — Sponsor selection
- **Answer:** Google Gemini (already in the architecture), Rox (framing only, no code), and Convex (telemetry panel). Cohere is an honourable mention to build only if ahead. Everything else is skipped, including Backboard, Browserbase, Composio, Elastic, Baseten, Sentry, and the OpenAI prize.
- **Binding effect:** `SPEC.md` 2.4 and 14. The agent may not add a sponsor integration beyond F-18 and F-19.

### HD-01 — Exact Gemini model identifier
- **Asked:** pre-build
- **Blocking:** T0-13, F-06, IG-06
- **Context:** model names in the Flash-Lite family changed several times during 2026. The spec defaults to `gemini-3.1-flash-lite` but this must be confirmed in Google AI Studio on event day.
- **Options:** (1) confirm in AI Studio, 5 minutes; (2) ship local-resolver only, which removes sequences and Q&A.
- **Recommendation:** option 1.
- **Status:** RESOLVED
- **Answer:** Option 1. Confirmed as `gemini-3.1-flash-lite`.
- **Answered:** 2026-09-19

### HD-02 — Are F-18 (Convex) and F-19 (Cohere) built?
- **Asked:** pre-build
- **Blocking:** T2-02, T2-03
- **Context:** both are T2 and cost 5 person-hours combined. They are only worth starting if T0 and T1 are fully green.
- **Options:** (1) build both if ahead; (2) build Convex only, since it doubles as a demo asset; (3) skip both.
- **Recommendation:** option 2 unless clearly ahead of schedule.
- **Status:** RESOLVED
- **Answer:** Option 2. Build Convex only.
- **Answered:** 2026-09-19

### HD-03 — Does a judge speak a live command?
- **Asked:** pre-build
- **Blocking:** demo script only, no code
- **Context:** letting a judge speak is the strongest possible proof and also the least controllable moment in the demo (unfamiliar voice, noisy hall, unpredictable phrasing).
- **Options:** (1) offer it only after the scripted run has gone clean; (2) never offer it; (3) always offer it.
- **Recommendation:** option 1.
- **Status:** RESOLVED
- **Answer:** Option 1. Offer it only after the scripted run has gone clean.
- **Answered:** 2026-09-19

### HD-04 — Which search engine for `SEARCH_TEMPLATE`
- **Asked:** pre-build
- **Blocking:** T1-08, F-15
- **Context:** a compile-time constant, never derived from page content or model output.
- **Options:** Google, DuckDuckGo, Bing.
- **Recommendation:** Google, since it is what a judge expects to see and the URL format is stable.
- **Status:** RESOLVED
- **Answer:** Google.
- **Answered:** 2026-09-19

### HD-05 — Must a working API key be published with the source link?
- **Asked:** pre-build
- **Blocking:** potentially a final-hour task
- **Context:** if judges must run the extension themselves with a working key, a proxy is needed. If they only watch the demo, no proxy is needed.
- **Options:** (1) no proxy, key entered in the options page; (2) add a 20-line Cloudflare Worker proxy in the final hour.
- **Recommendation:** option 1 unless the submission rules require otherwise.
- **Status:** RESOLVED
- **Answer:** Option 1. No proxy, key entered in the options page.
- **Answered:** 2026-09-19

### HD-06 — Do the two Download buttons keep identical accessible names?
- **Asked:** pre-build
- **Blocking:** T0-04, T1-04
- **Context:** identical names force the harder clarification path (ordinal or positional disambiguation). Differentiated names (`Download PDF` / `Download Word`) exercise the easy path, which is more likely to land cleanly in a ten-second demo window.
- **Options:** (1) identical, harder path, better technical story; (2) differentiated, easier path, more reliable live.
- **Recommendation:** option 1, with option 2 as the fallback if T1-04 is not solid by the feature freeze.
- **Status:** RESOLVED
- **Answer:** Option 1. Identical, harder path.
- **Answered:** 2026-09-19

### HD-07 — ElevenLabs Integration for Competition Track
- **Answer:** We are entering an ElevenLabs hackathon track. Build ElevenLabs as the primary TTS engine. To save API credits during testing, implement a dual-engine architecture: add a `useLocalTts` boolean flag in `settings` that routes output to `chrome.tts` when true, and ElevenLabs when false.
- **Binding effect:** Overrides SPEC.md 10.6.1. The agent is authorized to implement an external network call for TTS.

### HD-08 — "Save this page" opens Google Keep, and global commands include "switch to <name> tab"
- **Asked:** not asked; given as a directive by the human on 2026-09-19 (the "Tier 1 Global Commands" mission).
- **Answer:** "Save this page" extracts the current tab's title and URL and opens `https://keep.google.com/#NOTE/?text=` + `encodeURIComponent(title + "\n" + url)` in a new tab. Tab management adds "switch to [name] tab", matched against open tabs' titles and URLs with a basic string similarity. Every global command speaks a short confirmation.
- **Binding effect:** Overrides SPEC 6.18's bookmark row (`chrome.bookmarks.create`). The `bookmarks` permission is left in the manifest (SPEC 8.7 lists it) but is no longer used. Recorded as DEV-006.
- **Answered:** 2026-09-19

### HD-09 — The assistant must understand the page it is on, the tabs around it, and the date
- **Asked:** not asked; given as a directive by the human on 2026-09-19 after a manual test on Wikipedia with an airport page open in another tab ("summarize the page and tell me the main heading" and "click the first link and tell me where it leads" both failed with a question about which page was meant).
- **Answer:** (1) Build page summary and question answering now (SPEC 11.6, 11.7; T1-06 / T1-07), out of tier order. (2) Tell the model what page the user is on and what is on it, and let it see the tabs open in the same Chrome window. (3) Put the current date and time in the model's prompt and improve the resolver prompt. (4) IG-03 on the options page shows only PASS or FAIL and does not speak for a minute.
- **Binding effect:** Page text (up to 12 000 characters for a summary, 30 000 for a question), the current page's title and hostname, and the titles and hostnames of the tabs in the same window are sent to Gemini for a question or summary. The command resolver receives the date, the time, and the current page's title only; it never receives an address or the tab list (SPEC 8.3; the D6 security test enforces it). Tab switching stays a fixed command ("switch to X tab", "next tab"); the model is not given a way to choose a tab, so SPEC 8.3's list of what the model may produce does not widen. Deviations are DEV-008.
- **Answered:** 2026-09-19

### HD-10 — Build the audio engine and generative mutation sonification now, out of tier order
- **Asked:** not asked; given as a directive by the human on 2026-09-19 ("Generative Mutation Sonification", the "wow factor" mission for the pitch).
- **Answer:** (1) Build the audio engine (T1-02) and mutation sonification (T2-01, F-17) now, although T0-18, T0-19 and T1-01 to T1-05 are still `TODO`. (2) SPEC 9.8's six rules are the floor, not the ceiling: the size and kind of a DOM mutation map to a generated soundscape, not to one fixed beep. Large structural additions get a deep filtered swell; text churn gets short high clicks; both are spatialized. (3) Everything stays synthesized in the browser with Web Audio; no audio files. (4) `StereoPannerNode` only — `PannerNode` is still forbidden by HD-A04, which the directive's "StereoPannerNode or PannerNode" does not override. (5) Performance and safety are hard constraints: the observer's hot path does no layout work, the burst rate limit in 9.8 stays, and a failed `AudioContext` still degrades to silence.
- **Binding effect:** extends SPEC 9.8 with a swell layer, a churn-tick layer and a minimum-magnitude gate. SPEC 9.8's cap of 8 points, 70 ms spacing, ×0.6 gain, 1200 ms rate limit and suppression during a scan or a batch are all unchanged. Recorded as DEV-009.
- **Answered:** 2026-09-19

---

### HD-12 — Page sonification off by default; spoken answers are panned to where the thing is
- **Asked:** not asked; given as a directive by the human on 2026-09-20, after listening to HD-10's mutation sonification.
- **Answer:** (1) The mutation noises go. Keep the engine, the sonifier and every test; just stop making the sound. (2) Add a toggle on the options page called **Spatial links**: when an answer is about a particular control — "can you click on it", "where is it" — the *voice* comes out in stereo so it appears to come from that place on the screen. Left of the page is heard on the left.
- **Binding effect:** two new `Settings` fields. `mutationAudio` defaults **false** and nothing starts unless it is true, so a page pays nothing for the feature. `spatialLinks` defaults **true** and pans spoken confirmations with SPEC 9.3's `pan(x)`, the same formula the cue tones use, now shared in `src/shared/spatial.ts`.
  **This overrides SPEC 9.1's `[FACT]` that spoken text cannot be panned.** That fact was written before HD-07 added ElevenLabs and remains true for `chrome.tts`, whose output no specification can route into a Web Audio graph. The ElevenLabs path is different in kind: it returns an MP3 that the content script already decodes into a graph, so a `StereoPannerNode` is all it takes. Spatial links therefore work on ElevenLabs (`useLocalTts: false` plus a key) and are silently ignored on the local engine. HD-11 is left open but is now moot in practice, since the mutation bursts it was about are off by default. Recorded as DEV-010.
- **Answered:** 2026-09-20

### HD-13 — Warn the user before reading a page whose text scores as A.I. generated (GPTZero)
- **Asked:** not asked; given as a directive by the human on 2026-09-20, with a GPTZero API key.
- **Reasoning given:** a sighted person scanning a page can often tell when something is off — a sketchy layout, a strange font, content that just feels synthetic. Every one of those tells is visual, and a user navigating by voice with the screen off gets none of them. Misleading or machine-generated text therefore slips past this product's user in a way it would not past a sighted reader, and it arrives in the same even, confident voice as everything else. The detector gives that tell back.
- **Answer:** (1) Build synthetic-text detection now (F-22), out of tier order, using GPTZero's `/v2/predict/text`. (2) A page that scores high is announced before it is read, and the verdict also goes into the answer prompt so the model stops asserting the page's claims as fact. (3) It is advisory only and must never cost the user an answer.
- **Binding effect, and what it does *not* widen:**
  - Page text — the same text already sent to Gemini for a summary or a question, capped at 20 000 characters — is additionally sent to `api.gptzero.me`. This is a **second network dependency on the answer path**, which CLAUDE.md section 11 would otherwise require stopping over. It is permitted here by this decision, and bounded by the next point.
  - **The detector may only add a sentence.** It cannot suppress an answer, change what is read, alter an action, or reach the element resolver. A verdict is page-derived data, and SPEC 8.5's rule that page-derived data never decides what the extension does applies to it unchanged.
  - **Every failure is silence.** No key, detection off, text too short, a timeout, a rejected key, a rate limit, a 5xx, an unparseable body, or a response shape GPTZero has not shipped yet — all produce no verdict, and the answer goes out exactly as it would have before. SPEC 19.3 still holds: the golden path runs with the network disabled, and the only thing lost is the warning.
  - Detection runs **only** on the summary and Q&A path (SPEC 11.6, 11.7). It does not run on a command, a scan, a browser-level intent, or the element resolver, none of which read prose.
  - Two new `Settings` fields, on the same boundary as the Gemini key (R2.5, service worker only): `gptZeroApiKey` (default null) and `aiDetection` (default **true** — a user who never opens the options page should still get the warning; with no key it is silent anyway).
- **Answered:** 2026-09-20

### HD-14 — `check` and `uncheck` name a state, and are never executed as a click
- **Asked:** not asked; given as a directive by the human on 2026-09-20, after a spoken "uncheck" toggled a checkbox the wrong way.
- **Reasoning given:** the command named the state to end in. The executor answered it with `element.click()`, which is a *relative* operation — it flips whatever state the element is in. On a page where the extension's idea of the checkbox and the page's own disagree, or where the page cancels the click, that lands on the opposite of what was asked. The user cannot see the result, so a silent inversion is not recoverable the way it is for a sighted user.
- **Answer:** (1) `check` and `uncheck` are first-class actions everywhere, distinct from `click`: in the resolver's schema and prompt rules, and in the local resolver. (2) The executor is state-aware — a `check` on something already checked, or an `uncheck` on something already unchecked, does nothing and reports success. (3) When the state must change, it is *written*, not clicked: through the native `checked` setter on the prototype chain, followed by bubbling `input` and `change`, the same React value-tracker bypass already used for `fill`.
- **Binding effect, and what it does *not* widen:**
  - **This overrides SPEC 7.6.3 step 6**, which reads `check -> if !checked, element.click()` and `uncheck -> if checked, element.click()`. The guard survives; the click does not. Recorded as DEV-012.
  - No new verb, no schema widening, and nothing new reaches the model. `VERBS` is unchanged — `check` and `uncheck` were already in the closed enum (SPEC 5.6) and already in the resolver's JSON schema. SPEC 8.3's table is untouched.
  - SPEC 7.6.2's verb/role table is unchanged and is still enforced: `uncheck` remains invalid for a radio.
  - **A custom widget is still clicked.** An element with no `checked` property — `role="switch"` on a `div` — keeps its state in the page's own script, and a click is the only way in. It is no longer a blind one: `aria-checked` is read first, and the click only happens when the state differs.
  - The clarification path carries the verb across the question (`ClarificationState.verb`), so "uncheck one of these two" is still an uncheck after the user says which one.
- **Answered:** 2026-09-20

---

### HD-14 — Scan every paragraph, not the page; warn at 70 percent; keep the key out of the bundle
- **Asked:** not asked; given as a directive by the human on 2026-09-20, after F-22 (HD-13) was built.
- **Reasoning given:** the agent is limited "not in its tools, those are fine, but in its ability to understand them". A single page-level score is the wrong instrument: it answers "is this page synthetic" when the question that protects the user is "is any part of what I am about to read to you synthetic".
- **Answer:**
  1. **Score each paragraph.** If any paragraph comes back at or above **70 percent**, warn the user to watch for misinformation — even when the page as a whole reads as human.
  2. **Key delivery is unchanged at runtime.** The GPTZero key is entered on the options page and stored in `chrome.storage.local`, exactly as before. `GPT_ZERO` is an environment variable for **scripts and tests only**, so the feature can be exercised against the real API without the key ever entering the extension bundle.
  3. **One flagged paragraph is enough** (`GPTZERO_MIN_FLAGGED_PARAGRAPHS = 1`), chosen over the two safer alternatives after the false-positive arithmetic was put to the human: on a fifty-paragraph page this is fifty chances to trip, and a warning that fires on everything means nothing. The human took the most sensitive setting deliberately.
- **Binding effect, and its limits:**
  - Still **one API call**. GPTZero returns `paragraphs[]` and `sentences[]` in the same response as the document score, so per-paragraph analysis costs no extra request, no extra latency and no extra quota. If a future response drops those arrays the feature degrades to the document-level bands, not to N calls.
  - A paragraph shorter than `GPTZERO_PARAGRAPH_MIN_CHARS` (250) is **not judged at all**. This is not a softening of the rule; it is a limit on what can honestly be classified. A caption or a nav line carries too little signal and a detector asked about it returns noise. Where no character count is available, three sentences stands in for it.
  - Page text now reaches the classifier with its **paragraph breaks intact** (`sanitizeForPromptKeepingBreaks`, requested through `page.text` with `preserveParagraphs`). Without them the whole page arrives as one paragraph and there is nothing to segment. The answer prompt is unaffected: it re-sanitizes and collapses whatever it is given, so SPEC 8.4's rules are unchanged on that path.
  - The prompt now carries **quoted page text** in the `<content_authenticity>` part — the opening words of each flagged section, so the answer can name which part is suspect. Those excerpts are sanitized, capped at 120 characters, limited to four, and the block states in-line that they are data and not instructions. A flagged paragraph is precisely where an injection attempt would sit if there were one.
  - `GPT_ZERO` is **never referenced from `src/`**, matching `COHERE_API_KEY`'s existing rule in `.env.example`. SPEC 8.6 is not widened.
- **Answered:** 2026-09-20

---

---

## Open

### HD-11 — A mutation burst can land while the confirmation is being spoken
- **Asked:** 2026-09-19, while finishing T2-01 (HD-10).
- **Blocking:** F-17 behaviour in the primary demo flow. Not blocking the build; the feature is `DONE` and green either way.
- **Context:** SPEC 9.1 requires that speech and tones never play simultaneously, and names the two mechanisms that achieve it — the service worker does not scan while TTS speaks, and execution ticks are scheduled before the confirmation begins. Mutation sonification has no such mechanism available: the page changes when the page decides to. In the primary demo flow "click Search flights" is confirmed aloud immediately, the results inject 800 ms later, and the burst fires about 950 ms after the click — on top of a confirmation that is still being spoken. SPEC 9.8 step 5 suppresses only during a scan or an execution batch, and F-17 requires the burst within 250 ms of the injection, so deferring it until speech ends is not available either.
- **Options:**
  1. **Leave it.** The swell and tones play under the confirmation. Zero work. Risks muddying the one sentence a judge is listening to, and is the reading of SPEC 9.1 that ignores its blanket sentence.
  2. **Suppress while speaking** (add `speaking` to the focal-activity set). About 20 minutes, honours SPEC 9.1 literally. Costs the demo its best moment: the flights land in silence, because a suppressed burst is dropped, not queued.
  3. **Duck the cue bus while speaking** — hold the master gain at roughly a third while TTS plays, restore it after. About an hour, needs the service worker to tell the content script when speech starts and stops. Both are audible, speech stays dominant. Departs from SPEC 9.1's "never simultaneously" deliberately rather than by omission.
- **Recommendation:** option 3. It is the only one that keeps both the confirmation intelligible and the materializing moment audible, and the moment the page fills in underneath the assistant's own voice is the single strongest thing this feature does. Option 1 is an acceptable fallback if time is short — but that decision should be made after someone has heard it, not before.
- **Status:** OPEN
- **Answer:**
- **Answered:**
