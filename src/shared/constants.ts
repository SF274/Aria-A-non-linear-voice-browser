/**
 * Tunable constants — T0-02 (F-01).
 *
 * Every value here cites the SPEC section that fixes it. SPEC 7.2.4 requires
 * that these live in exactly one place because IG-07 may need them tuned on
 * event day; no call site may inline any of them.
 */

// ---------------------------------------------------------------------------
// SPEC 7.2.4 — local resolver decision thresholds
// ---------------------------------------------------------------------------

/** SPEC 7.2.4: `s1 >= 0.85` (with margin) is CONFIDENT. */
export const LOCAL_CONFIDENT_THRESHOLD = 0.85;

/** SPEC 7.2.4: CONFIDENT needs `s1 - s2 >= 0.10`; AMBIGUOUS groups within 0.10 of `s1`. */
export const LOCAL_MARGIN = 0.1;

/** SPEC 7.2.4: below this best score the outcome is MISS, never AMBIGUOUS. */
export const LOCAL_AMBIGUOUS_FLOOR = 0.6;

/** SPEC 7.2.4 / 5.9: AMBIGUOUS requires 2 to 4 candidates. */
export const MIN_CLARIFY_CANDIDATES = 2;

/** SPEC 7.2.4 / 5.9: AMBIGUOUS requires 2 to 4 candidates. */
export const MAX_CLARIFY_CANDIDATES = 4;

// ---------------------------------------------------------------------------
// SPEC 9.3 — audio mappings, timbre, and envelope
// ---------------------------------------------------------------------------

/** SPEC 9.3: `pan(x) = clamp(2x - 1, -0.95, 0.95)`. Hard left/right are never reached. */
export const PAN_CLAMP = 0.95;

/** SPEC 9.3: `freq(y) = 220 * 2 ** (2 * (1 - y))`. Bottom of the document. */
export const TONE_BASE_FREQ_HZ = 220;

/** SPEC 9.3: the exponent factor in `freq(y)`; the scan spans two octaves (220 Hz to 880 Hz). */
export const TONE_OCTAVE_SPAN = 2;

/** SPEC 9.3: lowpass filter frequency for the Input role class is `freq(y) * 4`. */
export const INPUT_FILTER_FREQ_MULTIPLIER = 4;

/** SPEC 9.3: lowpass filter Q for the Input role class. */
export const INPUT_FILTER_Q = 1;

/** SPEC 9.3: the Other role class is attenuated by this factor. */
export const OTHER_ROLE_GAIN_MULTIPLIER = 0.7;

/** SPEC 9.3: the four timbre classes. */
export const ROLE_CLASSES = ["navigational", "control", "input", "other"] as const;

export type RoleClass = (typeof ROLE_CLASSES)[number];

/**
 * SPEC 9.3, "Timbre by role class" table, Roles column. Any role absent from
 * this map is the `other` class.
 */
export const ROLE_CLASS_BY_ROLE = {
  link: "navigational",
  tab: "navigational",
  menuitem: "navigational",
  button: "control",
  checkbox: "control",
  radio: "control",
  switch: "control",
  combobox: "control",
  listbox: "control",
  option: "control",
  textbox: "input",
  searchbox: "input",
  spinbutton: "input",
} as const satisfies Record<string, RoleClass>;

/**
 * SPEC 9.3, "Timbre by role class" table plus the per-class peak gains from the
 * envelope block. `other` carries a gain multiplier rather than a peak gain
 * because SPEC states "gain x 0.7" for that row and names no peak of its own.
 */
export const ROLE_CLASS_TIMBRE = {
  navigational: { oscillator: "sine", peakGain: 0.16 },
  control: { oscillator: "triangle", peakGain: 0.18 },
  input: {
    oscillator: "square",
    peakGain: 0.14,
    filter: {
      type: "lowpass",
      freqMultiplier: INPUT_FILTER_FREQ_MULTIPLIER,
      q: INPUT_FILTER_Q,
    },
  },
  other: { oscillator: "sine", gainMultiplier: OTHER_ROLE_GAIN_MULTIPLIER },
} as const;

/** SPEC 9.3: attack, a linear ramp to peak gain. */
export const TONE_ATTACK_MS = 10;

/** SPEC 9.3: sustain at peak gain. */
export const TONE_SUSTAIN_MS = 50;

/** SPEC 9.3: release, an exponential ramp down to {@link GAIN_FLOOR}. */
export const TONE_RELEASE_MS = 30;

/**
 * SPEC 9.3: total tone duration, 90 ms. Derived from its three phases so the
 * envelope can never silently disagree with the stated duration (the class of
 * arithmetic error SPEC D-006 records).
 */
export const TONE_DURATION_MS = TONE_ATTACK_MS + TONE_SUSTAIN_MS + TONE_RELEASE_MS;

/**
 * SPEC 9.3: `exponentialRampToValueAtTime` throws on a target of exactly 0.
 * Ramp here, then `setValueAtTime(0)`.
 */
export const GAIN_FLOOR = 0.0001;

// ---------------------------------------------------------------------------
// SPEC 9.7 — page layout scan (F-10)
// ---------------------------------------------------------------------------

/** SPEC 9.7 step 4: the scan plays at most 30 entries. */
export const SCAN_MAX = 30;

/** SPEC 9.7 step 5: one tone per entry at `t0 + i * 90 ms`. */
export const SCAN_TONE_SPACING_MS = 90;

/**
 * SPEC 9.7 step 7: total scan duration, 2700 ms. Derived, never hand-typed —
 * SPEC D-006 records that an earlier draft's cap and duration disagreed.
 */
export const SCAN_TOTAL_DURATION_MS = SCAN_MAX * SCAN_TONE_SPACING_MS;

// ---------------------------------------------------------------------------
// SPEC 11.4 — resolver response handling
// ---------------------------------------------------------------------------

/** SPEC 11.4 rule 2: abort the request via AbortController at 2500 ms. No retry. */
export const MODEL_TIMEOUT_MS = 2500;

/** SPEC 11.4 rule 1: a 5xx gets one retry after 300 ms, then fails. */
export const MODEL_5XX_RETRY_DELAY_MS = 300;

/** SPEC 11.4 rule 1: exactly one retry on 5xx. 429 and timeouts get none. */
export const MODEL_5XX_MAX_RETRIES = 1;

/** SPEC 11.4 rule 4 / 5.5 `maxItems`: at most five actions in one batch. */
export const MAX_ACTIONS = 5;

/** SPEC 11.4 rule 5: confidence outside [0,1] is clamped, then penalised by 0.1. */
export const MALFORMED_CONFIDENCE_PENALTY = 0.1;

// ---------------------------------------------------------------------------
// SPEC 12.2 — element index cap
// ---------------------------------------------------------------------------

/** SPEC 12.2: index cap, document order, `truncated: true` when exceeded. */
export const MAX_INDEX = 120;

// ---------------------------------------------------------------------------
// SPEC 6.1, 10.4 — hold-to-talk and watchdog timers
// ---------------------------------------------------------------------------

/** SPEC 6.1: taps shorter than this are discarded as accidental (ms). */
export const HOLD_MIN_DURATION_MS = 250;

/** SPEC 6.1 / 10.4: watchdog forces stt.stop if keyup never arrives (ms). */
export const WATCHDOG_TIMEOUT_MS = 15_000;

/** SPEC 6.4: if no final transcript arrives in this window, use last interim or ERROR (ms). */
export const TRANSCRIBING_TIMEOUT_MS = 3_000;

/** SPEC 5.9 / 7.5: clarification expires after this window (ms). */
export const CLARIFY_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// SPEC 4.5, 10.2, 10.3, 13 — storage keys (chrome.storage.local / .session)
// ---------------------------------------------------------------------------

/** SPEC 10.2: key in chrome.storage.local that records the mic grant result. */
export const MIC_GRANTED_KEY = "micGranted";

/** SPEC 4.5: key in chrome.storage.session that holds the serialized session. */
export const SESSION_STORAGE_KEY = "session";

/**
 * SPEC 10.3: key in chrome.storage.session for the cached recognition mode.
 * Avoids calling SpeechRecognition.available() on every command.
 */
export const RECOGNITION_MODE_KEY = "recognitionMode";

// ---------------------------------------------------------------------------
// SPEC 11 — Gemini defaults
// ---------------------------------------------------------------------------

/** SPEC 11.2: default model identifier from state/ENVIRONMENT.md. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

// ---------------------------------------------------------------------------
// SPEC 6.18 — tab / search / bookmark commands
// ---------------------------------------------------------------------------

/**
 * SPEC 6.18: compile-time constant URL template for web search.
 * `[HUMAN: HD-04]` Confirm the search engine before the demo.
 */
export const SEARCH_TEMPLATE = "https://www.google.com/search?q=%s";
