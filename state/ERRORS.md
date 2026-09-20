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

### E-002 — The e2e suite fails one or two tests per full run, a different one each time
- **Signature:** no single one. Across five full runs on 2026-09-19/20: one unnamed failure; then `qa-exhaustive.spec.ts:603 › D2b: HTTP 500 then success` (assertion); then a clean 56/56; then `qa-exhaustive.spec.ts:1064 › G2` and `:1080 › G3`, both `Error: Target page, context or browser has been closed` at `support\qa-harness.ts:354` (`deliverTranscript`). Every one of these passes when run alone.
- **Task:** not a task; observed while finishing T2-01 / T1-02 (HD-10).
- **First seen:** 2026-09-19, in the `pnpm verify` runs following the audio engine work.
- **What the evidence says:** the failures move between runs and between failure *kinds* — one is a 60 ms timing tolerance, the others are the browser disappearing mid-test. That is the shape of environment pressure, not of a logic fault, which would fail the same test every time.
  - `D2` prints its measurement: `retry issued 313 ms after the 500`, against an assertion window of `>= 300 && < 360`. The real value sits 13 ms above the floor with 47 ms of headroom, so a scheduling hiccup tips it. `D2b` asserts the same window on the same path.
  - Measured on the dev machine right after a failing run: **2.4 GB free RAM**, with the developer's own Chrome running (49 processes) alongside the suite. **No leaked Playwright browsers** — a scan for `chrome.exe` with `--load-extension` / `playwright-user-data` / `ms-playwright` in the command line returned 0, so the suite does clean up after itself. It is simply competing for memory with whatever else is open.
- **Attempt 1:** none. Characterisation only — no code and no test has been changed for this, and no tolerance has been widened.
- **Status:** OPEN
- **Root cause:** not established. **Not ruled out:** the audio work landed in the same session and adds a second `MutationObserver` (`childList` + `subtree` + `characterData`) plus a lazily created `AudioContext` to every page the suite opens, so it is a plausible increment to the load. Distinguishing it properly needs several full runs on the pre-HD-10 tree and several on this one — 30+ minutes — because a 1-in-56 random failure is not settled by one run of each. **Cheapest real mitigation, untried:** close other applications before `pnpm verify`, or give the run more headroom. Do not widen D2/D2b's window to make it green; that hides whichever cause it is.

## Resolved errors

### E-001 — jsdom layout and scrollIntoView missing in executor.spec.ts
- **Signature:** TypeError: Cannot read properties of undefined (reading 'role') at reResolveElement and Error: The property "scrollIntoView" is not defined on the object in test/dom/executor.spec.ts
- **Task:** T0-15
- **First seen:** 2026-09-19T16:01:18Z
- **Attempt 1:** Mock getBoundingClientRect, scrollIntoView, and document scroll dimensions in test/dom/executor.spec.ts, add null-safety guards in reresolve.ts and executor.ts, pass { hidden: true } to computeAccessibleName.
- **Status:** RESOLVED
- **Root cause:** jsdom lacks a layout engine, so getBoundingClientRect() returns zeroes (causing index builder and visibility checks to drop elements) and scrollIntoView is undefined by default. Resolved by adding realistic mocks and defensive function checks.

### E-0xx — F-22 broke six Suite G e2e tests by inserting a prompt part
- **Signature:** `qa-exhaustive.spec.ts` Suite G, G1/G4/G5/G7/G7b/G7c fail after F-22 adds `<content_authenticity>` as the third part of the answer prompt.
- **Cause:** the suite addressed prompt parts by position. `parts[2]` was the page text; it is now the authenticity block. G1 and G4 asserted on it directly, and — the one that mattered — the shared `setup()` Gemini stub picked which canned answer to return by reading `parts[2]`, so it silently returned the wrong answer instead of failing, which is what broke G5, G7, G7b and G7c.
- **Fix:** a `partNamed(call, tag)` helper; the stub and both assertions now find the part by its tag. The same change was made in `test/unit/qa-inert.spec.ts`, which failed the same way for the same reason.
- **Note for next time:** positional indexing into a prompt that gains parts does not fail loudly — a stub reading the wrong index returns a plausible wrong answer and the failure surfaces four tests away from its cause. Address prompt parts by name.
- **Attempts:** 1
- **Status:** RESOLVED — full Playwright suite green, 56/56, exit code 0.

### E-0xx — the GPTZero key did not persist: the Save button was above the field
- **Signature:** the human entered a GPTZero key on the options page, and it was gone next time the page opened. The Gemini and ElevenLabs keys persisted normally.
- **Cause:** not the save/load logic, which was correct and unit tested. `options.html` has exactly one "Save Settings" button and it lived inside the Gemini section; the Content Authenticity section (F-22) was appended *after* it. The GPTZero field therefore sat below the only control that writes to storage.
- **Why it looked like it worked:** "Test key on a sample" reads the input element directly rather than stored settings, so the key validated successfully and reported a real score. Every signal on the page said the key was good; nothing said it was unsaved.
- **Fix:** the Save button moved out of the Gemini section into its own block after the last settings section, so it is last in the document. `test/dom/options.spec.ts` now reads the shipped `options.html` and asserts every settings input appears before `#btn-save`, and that there is exactly one of them. The help text under the test button also says that testing a key does not save it.
- **Note for next time:** a DOM fixture that builds its own markup cannot catch this class of bug. The regression test had to read the real file.
- **Attempts:** 1
- **Status:** RESOLVED
