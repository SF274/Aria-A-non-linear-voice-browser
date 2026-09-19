# AGENT_RULES.md

Hard rules. These are not guidance. A run that violates one of these is a failed run even if the code works.

`CLAUDE.md` tells you how to operate. `SPEC.md` tells you what to build. This file tells you what you may never do.

---

## R1 — Scope

**R1.1** Do not build anything on the `CUT` list (SPEC 2.3) or the `FORBIDDEN` list (SPEC 2.4).

**R1.2** Do not partially build a forbidden item "as a stub", "behind a flag", or "for later".

**R1.3** Every line of code you write traces to a task ID in `TASKS.md` and a section of `SPEC.md`. If it does not, delete it.

**R1.4** Do not add a dependency that is not already in `package.json` without recording it in `state/DECISIONS.md` with the reason and the alternative you rejected.

**R1.5** Do not add a sponsor integration other than F-18 (Convex) and F-19 (Cohere), and only after T1 is complete.

---

## R2 — Security

**R2.1** The model never produces a CSS selector, an XPath, a URL, or JavaScript. There is no exception, no fallback path, and no debug mode where this is relaxed.

**R2.2** No `eval`, no `new Function`, no `chrome.scripting.executeScript` with a non-literal `func` or `files` argument, anywhere.

**R2.3** Every `elementId` is validated against the current index `buildId` before execution. A batch containing one invalid action executes zero actions.

**R2.4** `input[type=password]` elements are excluded from `PromptElement[]` and rejected at execution validation. Both, not either.

**R2.5** The API key appears only in the `x-goog-api-key` request header. Never in a URL, never in telemetry, never in a log line, never in the content script or offscreen bundles.

**R2.6** Page-derived text is sanitized (SPEC 8.4) before entering any prompt, and is never placed in a system instruction.

**R2.7** Do not add a permission to the manifest beyond the six in SPEC 8.7. Do not relax the MV3 content security policy.

**R2.8** The Q&A and summary paths can never produce an action. They do not share a response handler with the resolver.

---

## R3 — Architecture

**R3.1** The ownership table in SPEC 4.6 is binding. Do not move a responsibility between components.

**R3.2** The service worker holds no in-memory state that must survive its own termination. Anything that must survive goes to `chrome.storage.session`.

**R3.3** The content script never decides which element to act on. It executes an instruction naming an id.

**R3.4** No DOM node reference crosses the resolve-execute boundary. Re-resolve per action (SPEC 12.8).

**R3.5** Speech is never panned. Non-speech tones are always positioned. The two channels never play simultaneously.

**R3.6** No backend on the request path. Telemetry writes fire after the action completes and are never awaited.

---

## R4 — Verification

**R4.1** `DONE` requires `pnpm verify` green and every SPEC 16 acceptance criterion for that feature passing.

**R4.2** Compilation is not completion. Reading the code is not testing.

**R4.3** Only the five items in SPEC 17.7 may be verified manually, and each needs a dated entry in `state/INTEGRATION_GATES.md` naming the human who ran it.

**R4.4** Do not weaken, skip, or `.only` a test to make a run green. If a test is wrong, fix the test and record why in `state/NOTES.md`.

**R4.5** Do not mark the project complete until all five conditions in SPEC 19.4 hold.

**R4.6** The six security tests in SPEC 17.5 are not optional and may not be deferred past the integration freeze.

---

## R5 — Failure handling

**R5.1** Record a failure in `state/ERRORS.md` before attempting a fix.

**R5.2** Two recorded fix attempts per error signature is the limit. A third is forbidden. Escalate to `state/HUMAN_DECISIONS.md` and switch tasks.

**R5.3** A retry that changes only a constant is the same attempt.

**R5.4** Never delete or disable working functionality to make failing functionality pass.

**R5.5** A failure is never a reason to add a feature.

**R5.6** Never write `TODO` and move on. Implement it, or mark the task `BLOCKED` with a reason.

---

## R6 — State discipline

**R6.1** Update `state/STATUS.md` at the end of every task, successful or not.

**R6.2** Any departure from `SPEC.md` gets a `state/DEVIATIONS.md` entry with all five fields (SPEC section, original requirement, why, replacement, cost). No exceptions, including departures you consider trivial.

**R6.3** Never edit `state/HUMAN_DECISIONS.md` except to add a question under "Open". Answers are written by the human.

**R6.4** Never delete an `ERRORS.md` or `DEVIATIONS.md` entry. Mark it resolved.

**R6.5** Never rewrite `SPEC.md`. If SPEC is wrong, record it in `DEVIATIONS.md` and escalate.

---

## R7 — Time

**R7.1** Do not start a T1 task while any T0 task is `TODO` or `BLOCKED`.

**R7.2** Do not start a T2 task while any T0 or T1 acceptance criterion is failing.

**R7.3** After the feature freeze recorded in `state/STATUS.md`, write no new features. Bug fixes to failing acceptance criteria only.

**R7.4** Never merge a change that makes hold-to-talk, local resolution, execution, spoken confirmation, the audio scan, or mutation sonification depend on the network (SPEC 19.3).

---

## R8 — Communication

**R8.1** When escalating, state the question, the two or three options, what each costs, and your recommendation. Do not write an open-ended "what should I do".

**R8.2** Do not speak error objects or stack traces to the user through TTS. One short sentence (SPEC 6.19).

**R8.3** Do not write pricing, quota, or free-tier claims about any API into the README, the submission text, or any user-facing string.

**R8.4** Do not describe the audio layout scan as a validated accessibility win in any user-facing text (SPEC 1.4).
