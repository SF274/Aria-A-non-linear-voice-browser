# state/DECISIONS.md

**Authority:** rank 4 in `CLAUDE.md` section 4. A decision here may never contradict `SPEC.md`. If one does, SPEC wins and the entry is wrong.
**Purpose:** record architectural choices made during the build so a future session does not re-litigate them.

Format:

```
### D-00n — <one line>
- **Date:**
- **Context:** what problem forced a choice
- **Options:** what was on the table
- **Chosen:** what was picked
- **Why:** the deciding evidence, not a preference
- **Revisit if:** the condition that would reopen this
- **SPEC:** section this serves, or "extends SPEC" with a note on why SPEC was silent
```

---

## Decisions inherited from planning

These were made before the build started. They are recorded here because the reasoning is not obvious from the code, and an agent that does not know the reasoning will helpfully undo them.

### D-001 — Accessibility-tree grounding, not vision
- **Date:** 2026-09-19 (pre-build)
- **Context:** the model needs to identify page elements.
- **Options:** multimodal model returning bounding boxes; `chrome.debugger` with `Accessibility.getFullAXTree`; in-page AccName computation.
- **Chosen:** in-page AccName computation via `dom-accessibility-api`.
- **Why:** vision costs a screenshot and a multimodal round trip per command, and the prior art this project builds on reported its bounding-box approach as insufficiently accurate. `chrome.debugger` raises a persistent "DevTools is debugging this browser" banner, visible in every demo and screen recording. AccName runs in roughly 5 ms and is deterministic.
- **Revisit if:** a class of control turns out to be unreachable by accessible name, for example a canvas-rendered widget. Then add a narrow fallback for that class only, after the demo works.
- **SPEC:** 12.1, 12.4

### D-002 — Two-tier resolution, local before model
- **Date:** 2026-09-19 (pre-build)
- **Options:** model call on every command; local-only; two tiers.
- **Chosen:** two tiers, local first.
- **Why:** drops p50 from roughly 1.2 s to roughly 0.5 s, makes the common demo path network-independent, and produces the `tier` field that makes the latency claim visible rather than merely asserted.
- **Revisit if:** IG-07 shows tier-one accuracy below 12 of 20 after constant tuning. That indicates the scoring is wrong, not the architecture.
- **SPEC:** 7.1

### D-003 — Pan for X, pitch for Y, no HRTF
- **Date:** 2026-09-19 (pre-build)
- **Options:** `PannerNode` with HRTF and a distance model; `StereoPannerNode` plus oscillator frequency.
- **Chosen:** `StereoPannerNode` plus frequency.
- **Why:** generic HRTFs produce high front-back confusion (a mean initial rate of 40.7% is reported) and poor median-plane accuracy, and head tracking, the intervention that fixes this, is unavailable on a laptop with headphones. A 2023 blindfolded sensory-substitution study comparing HRTF-only elevation encoding against pitch-based encoding found pitch more accurate for elevation with only slight azimuth differences. The distance model attenuates gain, which perceptually reads as urgency and would fight the interface's other cues.
- **Revisit if:** head tracking becomes available. Not on this hardware.
- **SPEC:** 9.2

### D-004 — No `navigate` verb
- **Date:** 2026-09-19 (pre-build)
- **Context:** an earlier draft of the resolver schema included a `navigate` verb taking a URL.
- **Chosen:** removed. Navigation happens only as a side effect of clicking a real anchor already present in the index.
- **Why:** a model-chosen URL is the single largest avoidable security surface in a voice-driven browser extension, and the capability it enabled is already covered by clicking the link.
- **Revisit if:** never, without a `HUMAN_DECISIONS.md` entry.
- **SPEC:** 5.5, 8.3

### D-005 — Document-relative coordinates, not viewport-relative
- **Date:** 2026-09-19 (pre-build)
- **Context:** an earlier draft normalized coordinates to the viewport.
- **Why:** viewport normalization produces `y` outside `[0,1]` for anything below the fold, which makes the audio scan of a scrolling page meaningless. The scan is supposed to describe the page, not the current window.
- **SPEC:** 12.6

### D-006 — `SCAN_MAX = 30`, not 40
- **Date:** 2026-09-19 (pre-build)
- **Why:** 40 elements at 90 ms is 3.6 s, not the "under three seconds" the feature claims. 30 at 90 ms is 2.70 s, which makes the claim true.
- **SPEC:** 9.7

### D-007 — "Save" means bookmark
- **Date:** 2026-09-19 (pre-build)
- **Context:** the retained feature set included "saving" and the prior art included printing and local file save.
- **Chosen:** `chrome.bookmarks.create`.
- **Why:** one low-risk permission instead of `downloads` plus a filesystem surface, and it demos identically in two seconds.
- **SPEC:** 6.18

### D-008 — Demo page split across tiers
- **Date:** 2026-09-19 (pre-build)
- **Context:** the demo page is the fixture every T0 test runs against, but was originally tiered T1.
- **Chosen:** F-16a (static structure) is T0; F-16b (dynamic behaviour) is T1.
- **Why:** a T0 test suite with no fixture cannot verify anything.
- **SPEC:** 2.2, 16

### D-009 — Convex and Cohere are the only sponsor integrations
- **Date:** 2026-09-19 (pre-build)
- **Options:** Browserbase, Backboard, Composio, Elastic, Cloudflare, Convex, Cohere.
- **Chosen:** Convex (telemetry, off the request path) and Cohere (build time only), both T2. Gemini is already in the architecture.
- **Why:** Convex is the only candidate that adds a demo asset rather than a dependency. Cohere's only defensible use here is a precomputed synonym map; runtime embedding is forbidden. Everything else either contradicts the premise, requires OAuth, or puts a third party on the critical path.
- **Revisit if:** HD-02 answers otherwise.
- **SPEC:** 14, 2.4

---

## Decisions made during the build

### D-010 — Budget headers corrected; day-1 trim list added
- **Date:** 2026-09-19
- **Context:** the tier budget lines in SPEC 2.2 originally said T0=19h, T1=11h. Those were hand-patched when F-16 was split and F-21 was added, without re-summing the actual task list. The real sums are T0=30.5h, T1=14h, T0+T1=44.5h, against a usable single-day budget of 25 to 31 person-hours.
- **Chosen:** corrected the budget lines to state the real sums, and added SPEC 19.1a, a trim list that reduces engineering rigor (validation depth, exhaustive error branches, automated test redundancy) rather than demo capability, in a fixed order.
- **Why:** the person-hour arithmetic did not support finishing T0+T1 as fully specified inside one day, and a spec that quietly overpromises its own timeline is worse than one that names the gap.
- **Revisit if:** never without re-summing TASKS.md first. Any future edit to a per-task `Est` value must be reflected in both the tier heading in SPEC 2.2 and the table in SPEC 19.1.
- **SPEC:** 2.2, 19.1, 19.1a

### D-011 — Hand-rolled MV3 bundler instead of `@crxjs/vite-plugin`
- **Date:** 2026-09-19
- **Context:** T0-01 names `@crxjs/vite-plugin` "or an equivalent MV3 bundler." `@crxjs/vite-plugin` parses `manifest.json` at config-load time and expects every referenced entry point (service worker, content scripts, extension pages) to already exist on disk. This repository's entry points land incrementally across T0-01, T0-03, T0-09, T0-12, T0-17 and others; a manifest-driven bundler would break `pnpm build` on every commit until the very last entry point is written, which fails R1.4/reliability in exactly the way SPEC 1.8 warns against.
- **Options:** (1) `@crxjs/vite-plugin`, accept the build breaking until every entry exists; (2) hand-rolled Vite config: a fixed candidate-entry map filtered to files that exist, plus a plugin that copies and JSON-validates the root `manifest.json` into `dist/`.
- **Chosen:** option 2, in `vite.config.ts`.
- **Why:** `pnpm build` must stay green after every task in the graph, not just the last one touching `manifest.json`. The hand-rolled version is roughly 60 lines, has zero new runtime dependencies, and gives exact control over the permission set in SPEC 8.7 and the CSP in 8.8, which later security work in T0-03/T0-18 will exercise directly.
- **Revisit if:** the candidate-entry map in `vite.config.ts` needs to grow beyond the fixed list already named in SPEC 4 (a new extension page type appears). Add the new relative path to `CANDIDATE_ENTRIES`; no other change needed.
- **SPEC:** 4, 8.7, 8.8; TASKS.md T0-01
