# ECHO — voice browser

A Chrome extension that lets someone operate any web page by voice, with the screen off.

Built at Hack the North 2026.

## For a coding agent

Start with **`CLAUDE.md`**. It is short and tells you where everything else is.

Do not start with this file, and do not start with `SPEC.md`.

## Repository map

| File | What it is |
| --- | --- |
| `CLAUDE.md` | Agent operating instructions and the authority hierarchy. Read first. |
| `SPEC.md` | The authoritative product and engineering specification. What to build. |
| `SURF.md` | The autonomous execution loop. How to operate the repository. |
| `TASKS.md` | The implementation task graph. |
| `AGENT_RULES.md` | Hard rules. Violating one fails the run even if the code works. |
| `AGENT_RUNBOOK.md` | Concrete commands, gate procedures, and the pre-demo checklist. |
| `state/` | Persistent memory across sessions. |

## For a human

`SPEC.md` section 1 is the product. Section 15 is the demo page. Section 19.4 defines done.

`state/HUMAN_DECISIONS.md` is where the agent asks you things. Check its "Open" section.
