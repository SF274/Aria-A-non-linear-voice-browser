# AGENT_RUNBOOK.md

Concrete procedures. `SURF.md` says what loop to run; this file says which commands to type.

---

## 1. First session bootstrap

```bash
pnpm install
cp .env.example .env          # fill in nothing yet; the key is entered in the options page
pnpm build
pnpm demo                     # serves demo/ on http://localhost:5174
pnpm verify                   # expected to fail until T0-01 is done
```

Load the extension: `chrome://extensions` → Developer mode on → Load unpacked → select `dist/`.

Record the Chrome version from `chrome://version` into `state/ENVIRONMENT.md` before anything else. Several gates depend on it.

---

## 2. Standard task cycle

```bash
# 1. baseline
pnpm verify

# 2. read the SPEC sections the task names, in full

# 3. implement, writing contracts and tests first

# 4. verify
pnpm verify

# 5. if the task touched sw/, content/, or offscreen/
pnpm test:e2e -- chain

# 6. commit
git add -A && git commit -m "T0-05: element index builder"

# 7. update state/STATUS.md
```

---

## 3. Commands

| Command | Does |
| --- | --- |
| `pnpm build` | Production bundle into `dist/` |
| `pnpm dev` | Watch build |
| `pnpm demo` | Static server for `demo/` on port 5174 |
| `pnpm test` | Vitest unit and DOM tests |
| `pnpm test:e2e` | Playwright browser tests |
| `pnpm test:e2e -- chain` | `IG-CHAIN` only |
| `pnpm test:e2e -- chain --repeat 10` | The ten-consecutive requirement |
| `pnpm test:e2e -- golden-path --repeat 10` | Golden path, ten consecutive |
| `pnpm test:resolver` | IG-07, tier-one hit rate across the 20 scripted commands |
| `pnpm test:perf` | IG-05, index build timing |
| `pnpm verify` | typecheck → lint → test → test:e2e. The completion gate. |
| `pnpm gate:gemini` | IG-06, validates the model identifier and schema conformance |
| `pnpm gate:convex` | IG-10 |
| `pnpm gate:latency` | IG-11, run at the venue |

---

## 4. Gate procedures

### IG-01 — on-device speech recognition
Open the options page, click "Check STT mode". It calls `SpeechRecognition.available({langs:["en-US"], processLocally:true})` and prints the result.
- `"available"` → PASS.
- `"downloadable"` / `"downloading"` → click "Install offline model", wait, re-check. **Do this on a good network, well before the demo.** Record the wall-clock time the download took.
- anything else → FAIL. Record the exact string. The cloud path still works; record the dependency on network in `state/DEVIATIONS.md`.

Confirm the model appears in `chrome://components` as the Speech Recognition / SODA component.

### IG-02 — speech recognition inside the offscreen document
On a **fresh Chrome profile**:
1. Load the extension.
2. Hold the hotkey on the demo page. `permission.html` should open as a tab and prompt.
3. Grant. The tab should close itself.
4. Hold the hotkey again and speak. A transcript should reach the service worker console.

FAIL behaviour: if step 4 throws `NotAllowedError`, switch to the `mic.html` iframe path (SPEC 10.2 fallback), re-test, and record a `DEVIATIONS.md` entry.

### IG-03 — chrome.tts long utterance
Options page → "Speak test passage". It speaks a 60 second chunked passage with the selected voice. PASS if it completes. If it stops near 15 seconds, the chunking is not being applied; that is a bug in `src/sw/tts.ts`, not a platform limit.

### IG-04 — Playwright loads the MV3 extension
```bash
pnpm test:e2e -- smoke
```
PASS when the test reaches the service worker via `ctx.serviceWorkers()` and can create an offscreen document. If the service worker is not reachable, Playwright may need `await ctx.waitForEvent("serviceworker")` on first load; that is a known ordering issue, not a blocker.

### IG-05 — index build performance
```bash
pnpm test:perf
```
PASS at under 120 ms for 120 elements. If it fails, the usual cause is calling `getComputedStyle` per element per command rather than once per build (SPEC 12.5).

### IG-06 — Gemini model identifier
```bash
GEMINI_API_KEY=... pnpm gate:gemini
```
Sends one minimal request with the configured model and `responseSchema`, and prints the model string and whether the response validated. FAIL on 404 means the model identifier is wrong. **This is `HD-01`.** Check Google AI Studio for the current Flash-Lite identifier, update `state/ENVIRONMENT.md` and `settings.geminiModel`, re-run.

### IG-07 — tier-one hit rate
```bash
pnpm test:resolver
```
PASS at 12 or more of 20 on tier one with the correct target. If below, tune only the constants in `src/shared/constants.ts`. Do not add matching signals that are not in SPEC 7.2.3 without a `DECISIONS.md` entry.

### IG-08 — scan synchronization
```bash
pnpm test:e2e -- scan-sync
```
PASS at 30 ms maximum divergence across 30 elements. The usual failure is `setTimeout` scheduling instead of `AudioContext.currentTime` (SPEC 9.5).

### IG-09 — blackout overlay
```bash
pnpm test:e2e -- blackout
```
Plus one manual check: start a screen recording, toggle the overlay, confirm the recording is unaffected and that the overlay covers the full viewport including any fixed page headers.

### IG-10 — Convex from a service worker
```bash
pnpm gate:convex
```
FAIL usually means the client's transport is blocked by the default extension CSP. Fallback: a plain `fetch` POST to a Convex HTTP action. Record the change in `DEVIATIONS.md`.

### IG-11 — venue latency
Run at the venue, on venue wifi:
```bash
pnpm gate:latency
```
Fires 20 model-tier resolutions and prints p50 and p95. Requests abort at `MODEL_TIMEOUT_MS = 2500` with no retry, so a p95 at 2500 ms means requests are being cut off, not that they are slow. If p50 exceeds 1500 ms, apply the fixes in SPEC 11.5 in the order listed. Do not raise the timeout; a longer wait is worse for the user than a clarifying question.

### IG-12 — Convex failure isolation
```bash
pnpm test:e2e -- telemetry-isolation
```
Blocks the Convex route and re-runs the full acceptance set.

### IG-CHAIN — full chain
```bash
pnpm test:e2e -- chain --repeat 10
```
PASS on ten consecutive green runs. Record the date, the Chrome version, and the run count.

---

## 5. Recording a gate result

Append to `state/INTEGRATION_GATES.md`:

```markdown
### IG-06 — Gemini model identifier
- **Status:** PASS
- **Date:** 2026-09-19T18:40Z
- **Chrome:** 151.0.7712.44
- **Run by:** agent, `pnpm gate:gemini`
- **Result:** `gemini-3.1-flash-lite` accepted, responseSchema honoured, 412 ms round trip
- **Blocks:** F-06 — now unblocked
```

`FAIL` and `BLOCKED` entries need one extra field: **Fallback applied**, naming the `DEVIATIONS.md` entry.

---

## 6. Recording an error

```markdown
### E-004 — SpeechRecognition NotAllowedError in offscreen document
- **Signature:** `NotAllowedError: Permission denied` from `recognition.start()` in `src/offscreen/stt.ts`
- **Task:** T0-10
- **First seen:** 2026-09-19T20:12Z
- **Attempt 1:** re-ran `ensureMicPermission()` before `ensureOffscreen()`. No change.
- **Attempt 2:** switched to the `mic.html` iframe path per SPEC 10.2. Resolved.
- **Status:** RESOLVED via DEV-002
- **Root cause:** the offscreen document was created before the permission tab had closed, so the permission state had not propagated.
```

Two attempts is the limit. A third requires an escalation in `state/HUMAN_DECISIONS.md`.

---

## 7. Recording a deviation

All five fields, always:

```markdown
### DEV-002 — speech recognition moved from offscreen document to extension iframe
- **SPEC section:** 4.3, 10.2
- **Original requirement:** `SpeechRecognition` runs inside the offscreen document created with reason `USER_MEDIA`.
- **Why it cannot be met:** IG-02 failed; see E-004.
- **Replacement behaviour:** the content script injects a hidden `chrome-extension://<id>/mic.html` iframe with `allow="microphone"` and recognition runs there. Transcripts reach the service worker by the same message types.
- **Consequence:** one extra frame per page; the offscreen document is no longer created; `SPEC.md` 4.3's ownership statement now applies to the iframe. Tests in `test/e2e/mic-permission.spec.ts` updated accordingly.
```

---

## 8. Escalation format

Append to `state/HUMAN_DECISIONS.md` under "Open":

```markdown
### HD-nn — Gemini model identifier returns 404   <- example only, allocate the next free number
- **Asked:** 2026-09-19T19:05Z
- **Blocking:** T0-13, F-06, IG-06
- **Context:** `gemini-3.1-flash-lite` returns 404. Two other identifiers tried, both 404.
- **Options:**
  1. Use the identifier listed in AI Studio today. Cost: 5 minutes, needs someone logged in.
  2. Ship with the local resolver only. Cost: sequences and Q&A are gone; the primary demo falls back to the two-step version per SPEC 19.3.
- **Recommendation:** option 1.
- **Status:** OPEN
```

Then pick a different task. Do not wait.

---

## 9. Pre-demo checklist

Run in this order, at T-3 hours.

```
[ ] pnpm verify green
[ ] pnpm test:e2e -- chain --repeat 10        green
[ ] pnpm test:e2e -- golden-path --repeat 10  green
[ ] IG-01 PASS, SODA model installed and visible in chrome://components
[ ] IG-03 PASS with the exact voice that will be used
[ ] IG-06 PASS with the exact model identifier in settings
[ ] IG-09 PASS including the manual recording check
[ ] IG-11 run on venue wifi, p50 recorded
[ ] Demo page summary pre-seeded into the cache
[ ] Full golden path run once with wifi disabled; only the specified degradation observed
[ ] Chrome auto-update disabled; Chrome not restarted after this point
[ ] Two wired headphone pairs and a splitter present
[ ] API key present in chrome.storage.local on the demo machine
[ ] state/STATUS.md reflects reality
```

`[Rule]` Do not restart Chrome after this checklist is green. A mid-event Chrome update changing an API is a documented risk and the mitigation is not restarting.

---

## 10. Things that will waste an hour if you forget them

1. `speechSynthesis` output cannot be routed into Web Audio. Do not try to pan speech. (SPEC 9.1)
2. `getUserMedia` cannot *prompt* from an offscreen document, popup, or side panel. Only from a real tab. (SPEC 10.2)
3. `"microphone"` is not a valid MV3 manifest permission.
4. The `pause`/`resume` keepalive is a `speechSynthesis` workaround and does nothing for `chrome.tts`.
5. `AudioContext` starts suspended. `resume()` must happen inside the keydown handler.
6. `exponentialRampToValueAtTime(0, ...)` throws. Ramp to `0.0001`.
7. `OscillatorNode` cannot be restarted after `stop()`. Create one per tone.
8. Setting `input.value` without dispatching `input` and `change` does not update a framework-controlled field.
9. A cached DOM node reference goes stale between resolve and execute. Re-resolve per action.
10. Serve the demo page over HTTP, not `file://`.
11. The service worker is terminated when idle. In-memory state does not survive.
12. Reloading the extension does not re-inject the content script into open tabs. Use `chrome.scripting` or reload the tab.
