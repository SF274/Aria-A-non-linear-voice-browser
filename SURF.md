# SURF.md — autonomous execution specification

`SPEC.md` defines what the system must be. This file defines how to operate the repository to build it.

---

## 1. The loop

```
┌─────────────────────────────────────────────────────────────┐
│  1. READ STATE                                              │
│  2. RECONCILE STATE WITH REALITY                            │
│  3. SELECT NEXT VALID TASK                                  │
│  4. CHECK DEPENDENCIES AND GATES                            │
│  5. READ THE SPEC SECTIONS THE TASK NAMES                   │
│  6. IMPLEMENT                                               │
│  7. TEST                                                    │
│  8. INTEGRATE                                               │
│  9. VERIFY ACCEPTANCE CRITERIA                              │
│ 10. UPDATE STATE                                            │
│ 11. CHECK FREEZE AND COMPLETION CONDITIONS                  │
│     └──► back to 1                                          │
└─────────────────────────────────────────────────────────────┘
```

One task at a time. Never two.

---

## 2. Step 1 and 2 — read and reconcile

Read, in order: `state/STATUS.md`, `state/HUMAN_DECISIONS.md` (Open section), `state/ERRORS.md` (open entries), `state/DEVIATIONS.md`, `state/INTEGRATION_GATES.md`.

Then reconcile. Run `pnpm verify`.

| Finding | Action |
| --- | --- |
| A task is `DONE` but its tests fail | Set to `IN_PROGRESS`. Note the correction in `state/NOTES.md`. That task is now the next task. |
| A task is `IN_PROGRESS` from a previous session | Resume it. Do not start something else. |
| `pnpm verify` fails for a reason unrelated to any task | Treat as a failure per SPEC 20 and fix before proceeding. A red baseline makes every subsequent result meaningless. |
| A gate is `BLOCKED` and blocks the next task | Select a different task. |
| An `ERRORS.md` entry has 2 attempts and no resolution | Confirm it is escalated in `HUMAN_DECISIONS.md`. Do not attempt a third fix. |

`[Rule]` Never begin implementation against a red baseline.

---

## 3. Step 3 — task selection

Apply these filters in order. The first task surviving all of them is the next task.

1. **Resume:** any task in `IN_PROGRESS`.
2. **Tier:** lowest tier with any incomplete task. T0 before T1 before T2. No exceptions (AGENT_RULES R7.1, R7.2).
3. **Freeze:** if the feature freeze has passed, only tasks fixing a failing acceptance criterion are eligible.
4. **Dependencies:** every task in `Depends` is `DONE`.
5. **Gates:** every gate in `Blocked by gate` is `PASS` or `N/A`.
6. **Human:** no unanswered `HUMAN_DECISIONS.md` question blocks it.
7. **Unblocking value:** among survivors, pick the one that appears in the most other tasks' `Depends` lists.
8. **Tie break:** lowest task ID.

If no task survives, do not invent one. Go to section 9.

---

## 4. Step 4 — dependency and gate check

Before writing code:

- Confirm each dependency's acceptance criteria actually pass, not just that `STATUS.md` says `DONE`. A dependency that is wrong will cost more than the check.
- If a blocking gate has never been run, run it now. Running a gate is always a legal action regardless of tier.
- Record the gate result in `state/INTEGRATION_GATES.md` with the date, the Chrome version, and how it was run.

A gate that fails does not necessarily block the task. Check whether `SPEC.md` names a fallback for that gate. If it does, implement the fallback and record a `DEVIATIONS.md` entry. If it does not, escalate.

---

## 5. Steps 5 to 7 — implement and test

1. Read every `SPEC.md` section the task names, in full. Not a summary. The details in those sections are the difference between a working build and a rebuild.
2. If the task introduces a contract, write it into `src/shared/contracts.ts` with runtime validation first.
3. Write the tests named in the task's `Tests` field.
4. Implement.
5. Run `pnpm verify`.

`[Rule]` If implementation reveals that the SPEC section is ambiguous, stop and re-read the surrounding sections. Most apparent ambiguity is resolved elsewhere in the document. Escalate only if it genuinely is not.

`[Rule]` If implementation reveals the SPEC is wrong, do not silently implement something better. Record a `DEVIATIONS.md` entry, then implement.

---

## 6. Step 8 — integrate

After a task passes in isolation, run the chain. `IG-CHAIN` (SPEC 18.1) is cheap to run and catches the class of bug that unit tests cannot: two components that each satisfy their contract but disagree about the contract's meaning.

`[Rule]` Run `IG-CHAIN` after every task that touches the service worker, the content script, or the offscreen document. Record the result.

`[Rule]` Do not accumulate more than two unintegrated tasks. The integration freeze at T-12 exists because parallel work that integrates late is the most common way a hackathon build dies.

---

## 7. Step 9 and 10 — verify and update state

A task is `DONE` when:

- `pnpm verify` is green, and
- every acceptance criterion in `SPEC.md` section 16 for that feature passes, checked one by one, and
- `IG-CHAIN` still passes if the task touched the chain.

Then update `state/STATUS.md`:

- Move the task to `DONE` with the timestamp.
- Update the tier progress counts.
- If the task revealed anything durable, append to `state/NOTES.md`.
- If the task departed from SPEC in any way, append to `state/DEVIATIONS.md`.
- If a decision was made that a future session would otherwise re-litigate, append to `state/DECISIONS.md`.

If the task cannot be finished:

- Set it to `BLOCKED` with a one-line reason and the blocking item (`ERRORS.md` entry, gate ID, or `HUMAN_DECISIONS.md` question).
- `BLOCKED` is a legitimate outcome. A task marked `DONE` with a known failing criterion is not.

---

## 8. Step 11 — freeze and completion checks

Read `startedAt` and the freeze timestamps in `state/STATUS.md`.

| Condition | Action |
| --- | --- |
| Integration freeze passed and `IG-CHAIN` has never passed | Stop all feature work. `IG-CHAIN` is now the only task. |
| Feature freeze passed | Only bug fixes to failing acceptance criteria are eligible. |
| Hard stop passed | Stop writing code. Update the README and the submission checklist only. |
| All five SPEC 19.4 conditions hold | Go to section 9. |

---

## 9. When no task is selectable

In this order:

1. **Any gate not yet run?** Run it. This is always useful and never out of scope.
2. **Any `BLOCKED` task whose blocker is now resolved?** Unblock it.
3. **Any acceptance criterion in SPEC 16 that has no corresponding test?** Write the test. This is the highest-value work available when the task graph is exhausted, because it converts assumed completeness into verified completeness.
4. **`IG-CHAIN` and the golden path each passed fewer than 10 consecutive times?** Run them until they have.
5. **All of the above done?** Write the completion report into `state/STATUS.md`, list every open `HUMAN_DECISIONS.md` question, and stop.

`[Rule]` "No task selectable" is never a reason to start a T2 or FORBIDDEN item.

---

## 10. Handling specific situations

### 10.1 Incomplete work from a previous session

Resume it. Read the task's SPEC sections again, read the partial implementation, and continue. Do not restart from scratch unless the partial implementation violates an `AGENT_RULES.md` rule, in which case delete it and note why in `state/NOTES.md`.

### 10.2 Failed tests

SPEC 20. Record first, then two bounded attempts in distinct directions, then escalate.

### 10.3 Blocked tasks

Mark and move on. Do not accumulate blocked tasks silently; if three or more tasks in the same tier are `BLOCKED`, that is a signal the blocker is structural and should be escalated as one question rather than three.

### 10.4 Deviations

Five fields, always: SPEC section, original requirement, why it cannot be met, replacement behaviour, consequence. A deviation without the consequence field is incomplete, because the consequence is what a future session needs to know.

### 10.5 Stale documentation

If `TASKS.md` or a state file contradicts `SPEC.md`, SPEC wins (`CLAUDE.md` section 4). Correct the stale file, note the correction in `state/NOTES.md`, and continue. Do not correct `SPEC.md`.

### 10.6 Dependency failures

A third-party package that does not work as expected is an `ERRORS.md` entry, not a reason to reimplement it by hand. SPEC names `dom-accessibility-api` and `aria-query` specifically because hand-rolling them is a known trap. If one genuinely does not work, escalate.

### 10.7 Integration failures

A component-level pass with a chain-level fail means a contract is being interpreted differently on the two sides. Do not fix it by loosening validation. Find which side is wrong against `SPEC.md` section 5 and fix that side.

### 10.8 Time pressure

Protect the chain. In order: `IG-CHAIN`, then the golden path test, then T0 criteria, then T1 criteria, then everything else. Shipping T0 plus a green chain beats shipping T1 with a broken chain.

### 10.9 Completion

Do not declare completion early. SPEC 19.4 has five conditions and all five are checkable. Check them.

---

## 11. Session boundary protocol

At the end of a working session, before context is lost, write:

1. `state/STATUS.md` — current task states, updated counts.
2. `state/NOTES.md` — anything you learned that a fresh session would spend time rediscovering.
3. `state/ERRORS.md` — every open failure with its attempt count.

`[Rule]` A future session starts by reading these files and nothing else from this one. Write them as though the reader has never seen this repository. That reader is you.
