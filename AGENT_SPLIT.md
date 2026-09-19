# AGENT_SPLIT.md — running two agents on this repo at once

This file exists because two coding agents (Claude Code and Gemini) are working this repository concurrently. It adds a coordination layer on top of `CLAUDE.md` and `AGENT_RULES.md`. **It does not relax anything in either.** Both agents follow `AGENT_RULES.md` identically. This file only says who touches what, and how not to collide.

If you are an agent reading this: find your identity below, read your task list and file ownership, and follow the coordination protocol in section 4 before touching anything.

---

## 1. Identities

| Identity | Tool | Role |
| --- | --- | --- |
| `claude` | Claude Code | Owns the foundation, the chain, and the demo-critical differentiators. |
| `gemini` | Gemini | Owns the parallel-safe retained-core plumbing and fixtures. |

Every `state/STATUS.md` claim, every commit message, and every `state/NOTES.md` entry is tagged with one of these two identities.

---

## 2. Why the split is drawn here

`claude` gets everything where a mistake cascades: the shared contracts every other file imports, the security-validated resolver and executor, and the three features that are the actual demo (`SPEC.md` 1.6, 1.7). This is deliberate. `AGENT_RULES.md`'s density of "never do X" constraints is highest exactly there, and holding many interlocking constraints without drifting is what the whole zero-ambiguity spec was written to support.

`gemini` gets short, unambiguous, low-security-surface tasks: the demo page markup, the options page, tab and bookmark commands, summary and Q&A plumbing. None of these touch the resolver, the executor, or anything in `SPEC.md` section 8's security boundary. `gemini`'s other job is integration debugging once the repo is large enough that dumping the whole thing plus failing logs into one context is the fastest way to find a disagreement between two files — that is a context-size advantage, not a claim that one agent codes better than the other.

---

## 3. Task ownership

### Model tier within `claude`'s own list

`claude`'s list is large enough (roughly 30.5 person-hours of specified work) that running all of it on Opus isn't just wasteful, it likely won't happen: Opus's usage allowance is much smaller than Sonnet's on every plan, and Max plans auto-downgrade to Sonnet once usage crosses a threshold regardless of what you're working on. Left to a usage-based auto-switch, Opus gets spent on whatever comes first in the task order, not on what actually needs it.

`[DECISION]` Default to Sonnet for everything `claude` owns. Manually switch to Opus, on purpose, only for:

| Task | Why Opus | Then |
| --- | --- | --- |
| T0-02 (shared contracts) | Every other file imports this. A subtle schema mistake here propagates everywhere else in the repo. | Switch back to Sonnet once merged. |
| T0-13 (Gemini client, prompts, response validation) | This is the prompt-injection boundary in `SPEC.md` section 8. Getting the sanitization or the schema wrong is the actual security risk, not a stylistic one. | Switch back after. |
| T0-14 (action validation) | The other half of the same boundary — the nine rules standing between a model suggestion and something executing in the browser. | Switch back after. |

For T0-05 (element index) and T0-15 (executor with re-resolution), implement on Sonnet, then run one Opus review pass before marking `DONE` — these are the two places where a "compiles and looks right" bug hides (accessible-name edge cases, stale-element handling) and a second, more careful read catches more than a full Opus rewrite would justify in quota.

Switch with `/model opus` immediately before one of the three tasks above, and back with `/model sonnet` (or just let a new session default back) once it's merged and reviewed. Don't leave it on Opus by default "to be safe" — that's the failure mode this section exists to avoid.

Reference: `TASKS.md`. IDs and dependencies are defined there; this table only assigns an owner.

### `claude` owns

```
T0-01  T0-02  T0-03   (solo — see section 5)
T0-05  T0-06  T0-07  T0-08  T0-09  T0-10  T0-11
T0-13  T0-14  T0-15  T0-16  T0-18  T0-19
T1-02  T1-03  T1-04  T1-05  T1-09  T1-10
```

### `gemini` owns

```
T0-04  T0-12  T0-17
T1-01  T1-06  T1-07  T1-08
T2-02  T2-03  T2-04         (only if T0 and T1 are fully green — AGENT_RULES R7.2)
```

`T2-01` (mutation sonification) has no owner yet. It depends on `T1-02`, which is `claude`'s. Whoever finishes their queue first and finds it unblocked may take it; whoever does, claims it in `state/STATUS.md` exactly as described in section 4.

**Neither agent takes a task from the other's list**, even if it looks idle, even if you finish your own list early. Section 4 covers what to do instead.

---

## 4. Coordination protocol

Before starting any task:

1. `git pull` (or equivalent sync). Do not start work on a stale tree.
2. Open `state/STATUS.md`. Confirm the task is `TODO` and every dependency in `TASKS.md` is `DONE`.
3. Edit the task's row: state → `IN_PROGRESS`, note → `claimed by <your identity>, <timestamp>`. Commit this claim by itself, before writing any implementation code, and push it immediately. This is the only step that has to land before the other agent might claim the same thing.

While working:

4. Edit only the files listed for you in section 6. If the task genuinely requires touching a file outside that list, stop, write a `state/NOTES.md` entry explaining why, and treat it as if a gate had failed — do not silently edit the other agent's files.

After finishing:

5. `pnpm verify` green, every acceptance criterion in `SPEC.md` 16 for that feature checked, exactly as `CLAUDE.md` section 8 requires.
6. Commit with the task ID in the message. `git pull --rebase` (resolve trivially if the other agent landed something unrelated), then push.
7. Update `state/STATUS.md`: state → `DONE`, note → completion timestamp. If anything durable came out of the task, write it to `state/NOTES.md`, `state/DECISIONS.md`, or `state/DEVIATIONS.md` as `CLAUDE.md` section 7 already specifies.

If blocked (a dependency from the other agent hasn't merged yet):

8. Do not idle and do not take a task from the other agent's list. Move to the next task in **your own** list whose dependencies are already met.
9. If every task in your own list is blocked, write a `state/NOTES.md` entry naming what you're waiting on and stop. Do not invent work.

If you hit the two-attempt limit on an error (`AGENT_RULES.md` R5.2), escalate exactly as specified. This is also a reasonable moment to note in `state/NOTES.md` that the other agent might want to look at it fresh, but the escalation itself still goes to `state/HUMAN_DECISIONS.md`, not to the other agent directly.

---

## 5. The solo foundation

`T0-01`, `T0-02`, and `T0-03` are `claude`-only and sequential, because `T0-02` produces `src/shared/contracts.ts` and `src/shared/constants.ts`, which every other file in the repository imports. Two agents editing the shared contract file at the same time is exactly the collision this whole file exists to prevent.

`gemini` may start `T0-04` (the demo page) as soon as `T0-01` merges — `T0-04` depends on nothing else. Everything else on `gemini`'s list waits for `T0-03` at minimum; check `TASKS.md` for the exact dependency of each.

---

## 6. File ownership

### `claude` — may edit

```
src/shared/contracts.ts          src/shared/constants.ts
manifest.json                    src/sw/index.ts
src/content/index.ts             src/content/index-builder.ts
src/content/observer.ts          src/content/hotkey.ts
src/content/executor.ts          src/content/reresolve.ts
src/content/blackout.ts          src/content/audio/**
src/pages/permission.html        src/pages/mic.html
src/offscreen/**                 src/sw/session.ts
src/sw/offscreen.ts              src/sw/tts.ts
src/sw/gemini/client.ts          src/sw/gemini/resolver.ts
src/sw/gemini/prompts.ts         src/sw/resolver/local.ts
src/sw/resolver/score.ts         src/sw/resolver/clarify.ts
src/sw/execute/validate.ts       src/sw/execute/sequence.ts
src/shared/normalize.ts
test/e2e/security/**             test/e2e/chain.spec.ts
test/e2e/scan-sync.spec.ts       test/e2e/blackout.spec.ts
test/e2e/golden-path.spec.ts
```

### `gemini` — may edit

```
demo/index.html   demo/styles.css   demo/app.js
src/pages/options.html   src/pages/options.ts
src/content/highlight.ts   src/content/overlay.css
src/content/page-text.ts   src/sw/gemini/summary.ts
src/sw/gemini/qa.ts        src/sw/route.ts
src/sw/cache.ts
src/sw/commands/browser.ts   src/sw/commands/verbosity.ts
scripts/build-synonyms.ts    src/data/**
src/sw/telemetry.ts   convex/**   panel/**
```

### Read-only for `gemini`

```
src/shared/contracts.ts
src/shared/constants.ts
```

If a `gemini` task needs a new field on an existing contract or a new constant, add a request to `state/NOTES.md` describing exactly what's needed and why. Do not edit the file directly. `claude` picks these up as part of whichever task next touches that file.

Both agents may read anything in the repository. Ownership above governs writes only.

---

## 7. What this file does not change

Everything in `CLAUDE.md`'s authority hierarchy, every rule in `AGENT_RULES.md`, and every completion condition in `SPEC.md` 19.4 apply identically to both agents. Two agents building faster is not a reason to relax verification, skip a security test, or mark something `DONE` early. `SPEC.md` 19.4's five conditions are checked once, against the whole repository, regardless of how many agents wrote it.