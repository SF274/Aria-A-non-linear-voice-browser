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

## Superseded

*(none yet)*
