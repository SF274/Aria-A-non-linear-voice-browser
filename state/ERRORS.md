# state/ERRORS.md

**Purpose:** persistent memory of what has already failed and what was already tried, so the agent does not loop.
**Rule:** record before fixing. Search this file for the same signature first.
**Rule:** two recorded attempts per signature is the limit. A third is forbidden; escalate to `HUMAN_DECISIONS.md` and switch tasks.
**Rule:** a retry that changes only a constant is the same attempt, not a new one.
**Rule:** never delete an entry. Mark it `RESOLVED`.

Format:

```
### E-00n — <one line>
- **Signature:** the exact error string and the file it came from. This is what future-you searches on.
- **Task:**
- **First seen:**
- **Attempt 1:** what was tried, what happened
- **Attempt 2:** what was tried, what happened
- **Status:** OPEN | RESOLVED via DEV-00n | ESCALATED to HD-00n
- **Root cause:** once known
```

---

## Known failure modes to expect

These have not happened yet in this repository. They are recorded because they are predictable, and recognising one early saves the two attempts.

| Likely signature | Almost certainly means | Read |
| --- | --- | --- |
| `NotAllowedError` from `getUserMedia` in the offscreen document | The tab-based permission grant never ran or has not propagated | SPEC 10.2 |
| `"microphone" is not a valid permission` at load | Someone added it to the manifest | SPEC 8.7 |
| Speech stops at roughly 15 seconds | Chunking is not being applied to a Google voice | SPEC 10.6.2 |
| Scan tones sound uneven | `setTimeout` scheduling instead of `AudioContext.currentTime` | SPEC 9.5 |
| `exponentialRampToValueAtTime` throws | Ramping to exactly 0 | SPEC 9.3 |
| First scan after a page load is silent | `AudioContext` still suspended; `resume()` is not in the keydown handler | SPEC 9.6 |
| A framework-controlled input does not update after `fill` | `input` and `change` not dispatched | SPEC 7.6.3 |
| An action silently does nothing on a page that just updated | A stale DOM node reference; re-resolution is not running per action | SPEC 12.8 |
| Content script unreachable after `pnpm build` | Extension reloaded without re-injecting; use `chrome.scripting` | SPEC 8.7 |
| Service worker loses state between commands | In-memory state that should be in `chrome.storage.session` | SPEC 4.1 |
| Gemini returns 404 | Model identifier is stale; this is HD-01 | SPEC 11.2 |

---

## Open errors

*(none yet)*

## Resolved errors

*(none yet)*
