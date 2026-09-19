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

*(none yet)*

## Superseded

*(none yet)*
