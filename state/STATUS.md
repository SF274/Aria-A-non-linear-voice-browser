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
| T0 | 19 | 7 | 0 | 0 | 12 |
| T1 | 10 | 0 | 0 | 0 | 10 |
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
| T0-06 Normalization | claude | TODO | |
| T0-07 Local resolver | claude | TODO | |
| T0-08 Session state machine | claude | TODO | |
| T0-09 Mic permission | claude | TODO | |
| T0-10 Speech recognition | claude | TODO | |
| T0-11 Hold-to-talk | claude | TODO | |
| T0-12 Options page | gemini | DONE | completed 2026-09-19T14:43:00Z; pnpm verify green, 8 unit/DOM tests passing, e2e options test passing (persists API key, no leaks, gate buttons functional), F-21 criteria fully met. |
| T0-13 Gemini client | claude | TODO | |
| T0-14 Action validation | claude | TODO | |
| T0-15 Executor | claude | TODO | |
| T0-16 TTS service | claude | TODO | |
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
| T1-06 Summary and cache | gemini | TODO | |
| T1-07 Q&A | gemini | TODO | |
| T1-08 Tabs, search, bookmark | gemini | TODO | |
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
*(none)*

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
