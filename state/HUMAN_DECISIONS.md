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

---

## Open

*(No open decisions at this time)*