# state/INTEGRATION_GATES.md

**Authority: rank 2.** A recorded FAIL here outranks `SPEC.md`. An experiment that disproves an assumption beats the assumption that produced the plan.

**Purpose:** track every check that must pass in the real environment before dependent work can be trusted. The system is verified as a chain, not as independent modules.

**Rule:** a gate that has not passed blocks its dependent features from being marked `DONE`.
**Rule:** `FAIL` and `BLOCKED` entries need a **Fallback applied** field naming the `DEVIATIONS.md` entry.

Statuses: `NOT_RUN` · `PASS` · `FAIL` · `BLOCKED` · `N/A`

Procedures for every gate are in `AGENT_RUNBOOK.md` section 4.

---

## Gate register

| ID | Gate | Blocks | Status | Last run |
| --- | --- | --- | --- | --- |
| IG-01 | On-device STT available for en-US | F-03 offline claim | NOT_RUN | — |
| IG-02 | `SpeechRecognition` starts in the offscreen document after the tab grant | F-02, F-03 | NOT_RUN | — |
| IG-03 | `chrome.tts` speaks a chunked 60 s passage to completion | F-08 | NOT_RUN | — |
| IG-04 | Playwright loads the MV3 extension, service worker reachable | all e2e | NOT_RUN | — |
| IG-05 | Index build under 120 ms for 120 elements | F-04 | NOT_RUN | — |
| IG-06 | Gemini model identifier valid, `responseSchema` honoured | F-06 | NOT_RUN | — |
| IG-07 | Tier-one hit rate at least 12 of 20 | F-05 | NOT_RUN | — |
| IG-08 | Scan tone and highlight synchronized within 30 ms | F-10 | NOT_RUN | — |
| IG-09 | Blackout overlay active, clicks still land, recording unaffected | primary demo | NOT_RUN | — |
| IG-10 | Convex write succeeds from an MV3 service worker | F-18 | NOT_RUN | — |
| IG-11 | Model p50 under 1500 ms on venue network | F-06 | NOT_RUN | — |
| IG-12 | Extension behaviour identical with Convex stopped | F-18 | NOT_RUN | — |
| IG-CHAIN | Full chain, microphone to spoken confirmation, 10 consecutive | project completion | NOT_RUN | — |

---

## Priority order

Run in this order. The first three are the ones most likely to invalidate the plan, so run them early even though they are not the first tasks.

1. **IG-02** — if this fails, the whole input path changes shape. Run it in the first hour.
2. **IG-01** — needs a model download on a good network. Run it before leaving good wifi.
3. **IG-06** — a stale model identifier blocks the entire model tier and is a five-minute fix if caught early.
4. **IG-04** — without it, no end-to-end test can run, and every subsequent gate depends on the harness.
5. Everything else in task order.

---

## Results

*(append one block per run, newest first)*

```
### IG-nn — <name>
- **Status:**
- **Date:**
- **Chrome:**
- **Run by:**
- **Command:**
- **Result:**
- **Blocks:** <feature IDs> — now unblocked / still blocked
- **Fallback applied:** <DEV-00n, or "none needed">
```
