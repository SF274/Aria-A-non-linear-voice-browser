# CLAUDE.md

Operating instructions for the coding agent working in this repository.

Read this file completely before doing anything else. It is short on purpose. It tells you where the real information is.

---

## 1. What this repository is

An autonomous build of **ECHO**, a Chrome Manifest V3 extension that lets someone operate any web page by voice with the screen off. It is a hackathon project with a hard deadline and a judged live demo.

The full product and engineering specification is in **`SPEC.md`**. That document is the source of truth for what to build.

---

## 2. Read order, first session

1. `CLAUDE.md` (this file)
2. `state/STATUS.md` — where the build currently stands
3. `state/HUMAN_DECISIONS.md` — decisions you may not override
4. `SPEC.md` sections 1 to 4 — product, scope, architecture
5. `SURF.md` — the execution loop you will run
6. `TASKS.md` — the task graph
7. `state/ENVIRONMENT.md` — what is installed and verified

Read the rest of `SPEC.md` on demand. Every task in `TASKS.md` names the `SPEC.md` sections it depends on. Read those sections in full before implementing that task. Do not implement from the task description alone.

## 3. Read order, every subsequent session

1. `state/STATUS.md`
2. `state/ERRORS.md` (open entries only)
3. `state/DEVIATIONS.md`
4. `state/INTEGRATION_GATES.md`
5. `TASKS.md`

Then resume the `SURF.md` loop.

---

## 4. Authority hierarchy

When two documents disagree, the higher entry wins. This list is the complete answer; do not adjudicate conflicts any other way.

| Rank | Source | Why it ranks here |
| --- | --- | --- |
| 1 | `state/HUMAN_DECISIONS.md` | An explicit human choice. Overrides everything, including SPEC. |
| 2 | `state/INTEGRATION_GATES.md` (recorded FAIL results) and `state/ENVIRONMENT.md` (verified facts) | Reality beats planning. A gate that failed disproves the assumption that produced the plan. |
| 3 | `SPEC.md` | The specification. Authoritative for everything not overridden above. |
| 4 | `state/DECISIONS.md` | Decisions made during the build. Must not contradict SPEC; if one does, SPEC wins and the decision entry is wrong. |
| 5 | `TASKS.md`, `SURF.md`, `AGENT_RULES.md`, `AGENT_RUNBOOK.md` | How to work. Never redefine what to build. |
| 6 | Existing implementation code | Code is evidence of what was built, not of what should exist. Code that contradicts SPEC is a bug. |
| 7 | `state/NOTES.md` | Observations. Never authoritative. |

Two rules follow from this list:

- **A task that conflicts with `SPEC.md` is a defective task.** Fix `TASKS.md`, record it in `state/DEVIATIONS.md`, then implement what SPEC says.
- **An experiment that disproves a SPEC assumption outranks the assumption.** Record the gate result, write a `DEVIATIONS.md` entry, and implement the replacement behaviour SPEC names for that failure, if it names one. If it does not, escalate.

---

## 5. How to determine current state

`state/STATUS.md` is the single answer. It lists every task with one of: `TODO`, `IN_PROGRESS`, `DONE`, `BLOCKED`.

`DONE` means every acceptance criterion in `SPEC.md` section 16 for that feature passes under `pnpm verify`. It does not mean the files exist. It does not mean it compiles.

If `STATUS.md` disagrees with the repository (a task marked `DONE` whose tests fail), the tests are right. Set the task back to `IN_PROGRESS` and note the correction in `state/NOTES.md`.

---

## 6. How to select the next task

Follow `SURF.md` section 3. In summary:

1. Lowest tier first. Never start a T1 task while a T0 task is `TODO` or `BLOCKED`.
2. All dependencies `DONE`.
3. All blocking gates passed or not applicable.
4. Prefer the task that unblocks the most other tasks.

Never work on two tasks at once.

---

## 7. How to implement

1. Read the SPEC sections the task names, in full.
2. Write the contract types first if the task introduces any (`src/shared/contracts.ts`).
3. Write the tests named in the task's "Tests" field before or alongside the implementation.
4. Implement.
5. Run `pnpm verify`.
6. Only when it is green, update `state/STATUS.md`.

Small commits, one per task, with the task ID in the message: `T0-04: element index builder`.

---

## 8. How to test

`pnpm verify` is the gate. It runs typecheck, lint, unit, DOM, and end-to-end tests.

You may not mark anything `DONE` on the basis of:

- it compiles
- the code looks correct
- a manual check you performed by reading output

`SPEC.md` section 17.7 lists the only five things that may be verified manually, and each requires an entry in `state/INTEGRATION_GATES.md` naming a human who ran it.

---

## 9. How to handle failure

`SPEC.md` section 20 is the protocol. The parts that matter most:

- Record every meaningful failure in `state/ERRORS.md` before attempting a fix.
- Search `ERRORS.md` for the same signature first. **Two recorded attempts on one signature is the limit.** A third attempt is forbidden; escalate instead.
- A second attempt that differs only in a constant is not a second attempt, it is the same attempt.
- Never delete or disable a passing feature to make a failing one pass.
- A failure is never a reason to add a feature.

---

## 10. When you may decide independently

You may decide, without asking:

- Internal file and module organization, naming, and code style within the repository conventions.
- Choice of a utility implementation (which fuzzy-match algorithm, how to structure a test helper) where SPEC does not specify one.
- The order of independent tasks within the same tier.
- Refactoring that does not change observable behaviour and keeps `pnpm verify` green.
- Adding a test.

## 11. When you must stop and ask

Stop, write the question into `state/HUMAN_DECISIONS.md` under "Open", and move to a different task when:

- A `CUT` or `FORBIDDEN` item (SPEC 2.3, 2.4) appears necessary.
- An acceptance criterion in SPEC 16 cannot be met and no replacement behaviour is specified.
- A gate fails and SPEC names no fallback.
- Two SPEC requirements contradict each other.
- A change would add a network dependency to the primary demo flow (SPEC 19.3).
- An error signature has two recorded fix attempts.
- A choice would spend more than 2 person-hours on something outside the current tier.
- Anything touching the API key, permissions, or the security boundary in SPEC 8 would need to widen.

Do not guess and document the guess afterwards. Stopping costs one question. Guessing costs a rebuild.

---

## 12. How to avoid scope creep

Before writing any code, ask: which task ID is this, and which SPEC section requires it?

If there is no answer to both, you are expanding scope. Stop.

Specific traps, all of which have a full entry in SPEC 21:

- Adding a retry around the model timeout.
- Letting the model return a selector or URL "for a fallback path".
- Building an options UI before the voice loop works.
- Making the audio scan continuous or interactive.
- Adding a sponsor integration that is not F-18 or F-19.

---

## 13. How to verify completion

The project is complete when `SPEC.md` section 19.4 holds:

1. Every T0 and T1 acceptance criterion passes.
2. `IG-CHAIN` passes ten consecutive times.
3. `test/e2e/golden-path.spec.ts` passes ten consecutive times.
4. The golden path runs with the network disabled, degrading only as specified.
5. No gate blocking a T0 or T1 feature is in `BLOCKED` state.

Until all five hold, `state/STATUS.md` must not say the project is complete. A build where every module passes and the chain does not is not a working project.

---

## 14. The one thing to remember

This project is judged on a live demo. A working chain beats a complete feature list. If you have to choose, protect the chain.
