# state/ENVIRONMENT.md

**Authority: rank 2** for anything marked VERIFIED. A verified environment fact outranks a planning assumption.

**Purpose:** what is installed, what version, and what has actually been confirmed to work on this machine.

**Rule:** fill in the Chrome version before running any gate. Several gates depend on it and a result without it is not reusable.

---

## Machine

| Field | Value | Status |
| --- | --- | --- |
| OS and version | — | UNVERIFIED |
| Chrome channel | stable | ASSUMED |
| Chrome version (`chrome://version`) | — | UNVERIFIED |
| Node version | — | UNVERIFIED |
| pnpm version | — | UNVERIFIED |
| Audio output for the demo | wired headphones | ASSUMED |
| Second screen available for the telemetry panel | — | UNVERIFIED |

---

## Required tooling

| Tool | Minimum | Why |
| --- | --- | --- |
| Node | 20 LTS | Vite 5, Playwright |
| pnpm | 9 | lockfile |
| Chrome | 142.0.7403.0 or later | on-device Web Speech regression fixed at this version |
| Playwright | current | `launchPersistentContext` with `--load-extension` |

---

## Runtime dependencies (expected)

| Package | Used for | SPEC |
| --- | --- | --- |
| `dom-accessibility-api` | `computeAccessibleName`, W3C AccName | 12.4 |
| `aria-query` | implicit role resolution | 12.3 |
| `zod` | runtime contract validation | 5 |

No other runtime dependency is expected. Adding one requires a `DECISIONS.md` entry naming the alternative rejected.

---

## API configuration

| Item | Value | Status |
| --- | --- | --- |
| Gemini model identifier | `gemini-3.1-flash-lite` (default) | **UNVERIFIED — this is HD-01 / IG-06** |
| Gemini endpoint | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | ASSUMED |
| Gemini API key | entered in the options page, stored in `chrome.storage.local` | NOT SET |
| `SEARCH_TEMPLATE` | undecided | **HD-04** |
| Convex deployment URL | — | not created |
| Cohere key (build time only) | — | not set |

**Do not write pricing, quota, or free-tier claims into this file or anywhere else.** Those change, and a wrong claim in a submission is worse than no claim.

---

## Browser capability status

Each row is an assumption from `SPEC.md` section 22.2 until its gate passes.

| ID | Capability | Gate | Status |
| --- | --- | --- | --- |
| AS-01 | `SpeechRecognition` works in an MV3 offscreen document after a tab-based grant | IG-02 | UNVERIFIED |
| AS-02 | On-device recognition available for en-US on this Chrome | IG-01 | UNVERIFIED |
| AS-03 | `chrome.tts` completes long chunked utterances | IG-03 | UNVERIFIED |
| AS-04 | Playwright loads MV3 + offscreen; fake media auto-grants the microphone | IG-04 | UNVERIFIED |
| AS-05 | Default extension CSP permits the Convex transport from a service worker | IG-10 | UNVERIFIED |
| AS-06 | The configured Gemini model exists and honours `responseSchema` | IG-06 | UNVERIFIED |
| AS-07 | `dom-accessibility-api` names every demo page control correctly | part of F-04 | UNVERIFIED |
| AS-08 | The demo headphones make the pan axis legible in a noisy hall | manual, SPEC 17.7 | UNVERIFIED |

---

## Verified facts

These are platform facts established before the build. They do not need re-verification and should not be re-litigated.

1. `"microphone"` is not a valid MV3 manifest permission.
2. `getUserMedia` cannot prompt for permission from an offscreen document, popup, or side panel. It only succeeds there once permission is already granted to the extension origin.
3. No specification defines a way to capture `speechSynthesis` output into a Web Audio graph. Speech cannot be panned.
4. `AudioContext` starts suspended until a user gesture occurs in the page.
5. MV3 forbids remotely hosted code. All dependencies must be bundled.
6. An MV3 service worker has no DOM, no `window`, no `AudioContext`, and is terminated when idle.
7. `chrome.offscreen` permits at most one offscreen document per extension.
8. `chrome.storage.local` has a default quota of roughly 10 MB.
9. Attaching `chrome.debugger` displays a persistent banner across the top of the tab.
10. Chromium bug 444393111: on-device Web Speech was disabled until version 142.0.7403.0 due to a language-specification regression.
11. Chrome has a long-standing bug where Google TTS voices stop after roughly 15 seconds of continuous speech.
12. `OscillatorNode` cannot be restarted after `stop()`.
13. `exponentialRampToValueAtTime(0, t)` throws.

---

## Pre-demo environment freeze

Once the pre-demo checklist in `AGENT_RUNBOOK.md` section 9 is green:

- Disable Chrome auto-update.
- Do not restart Chrome.
- Record the exact Chrome version here.
- Record the exact TTS voice name here.
- Record the Gemini model identifier here.
