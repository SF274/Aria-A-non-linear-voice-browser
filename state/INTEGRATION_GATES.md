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
| IG-03 | `chrome.tts` speaks a chunked 60 s passage to completion (the options button now runs it silently at volume 0 and checks that every chunk ends; it cannot hear the ~15 s network-voice cutoff, so a human must still hear a real-time run once) | F-08 | NOT_RUN | — |
| IG-04 | Playwright loads the MV3 extension, service worker reachable | all e2e | NOT_RUN | — |
| IG-05 | Index build under 120 ms for 120 elements | F-04 | PASS | 2026-09-19T14:25:35Z |
| IG-06 | Gemini model identifier valid, `responseSchema` honoured | F-06 | NOT_RUN | — |
| IG-07 | Tier-one hit rate at least 12 of 20 | F-05 | PASS | 2026-09-19T15:46:09Z |
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

### IG-07 — tier-one hit rate
- **Status:** PASS
- **Date:** 2026-09-19T15:46:09Z
- **Chrome:** Headless Chrome via Playwright & jsdom (vitest)
- **Run by:** gemini
- **Command:** `pnpm test:resolver`
- **Result:** 16 of 20 scripted commands resolved CONFIDENT on tier one (80.0% >= 60.0% threshold). All named F-05 acceptance cases passed ("download the itinerary" returned AMBIGUOUS with exactly the two download buttons, "make me a sandwich" returned MISS, disabled elements never win).
- **Blocks:** F-05 — now unblocked
- **Fallback applied:** none needed

### IG-05 — index build performance
- **Status:** PASS
- **Date:** 2026-09-19T14:25:35Z
- **Chrome:** Headless Chrome via Playwright & jsdom (vitest)
- **Run by:** claude
- **Command:** `pnpm test:perf`
- **Result:** Built 120-element synthetic DOM in 80.77 ms (<120 ms threshold). Serialized JSON size: 22.53 KB (<24 KB limit). On demo page: 25 controls built in 16.30 ms, serialized size 5.47 KB.
- **Blocks:** F-04 — now unblocked
- **Fallback applied:** none needed

### IG-11 — GPTZero classifies live text and the parser reads the real response (F-22)
- **Status:** PASS
- **Date:** 2026-09-20
- **Chrome:** Chrome, extension options page, real network
- **Run by:** the human (Madhav)
- **Command:** options page, Content Authenticity, "Test key on a sample"
- **Result:** `Key works. Sample scored 100% A.I. (AI_ONLY). You would hear: "Heads up: most of this page reads as A.I. generated text. Watch out for misinformation or incorrect details."` This closes the risk recorded in DEV-011 and N-0xx: the success response shape had never been observed, only a 403 confirming the URL, the method and the `x-api-key` header. `parseVerdict` produced a verdict from a live body, so at least one of its three score fields is present, and `document_classification` arrives and is read.
- **Blocks:** F-22 — now unblocked
- **Fallback applied:** none needed
- **Still unverified:** (1) whether `paragraphs[]` / `sentences[]` are in the response, so it is unknown which of the three extraction tiers HD-14's per-paragraph rule is actually running on — the raw body is logged to the options page console and answers this. (2) The false-positive rate on human prose: the probe sample is machine written by construction, so nothing here tests what an ordinary human-written page scores. Asking for a summary of a human-written page and listening for silence is the quickest check.

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
