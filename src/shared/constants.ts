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

/** SPEC 7.5.2 step 3: the confident threshold is lowered to this when matching a clarification reply. */
export const CLARIFY_REPLY_THRESHOLD = 0.55;

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
// SPEC 9.5 — the shared cue bus
// ---------------------------------------------------------------------------

/**
 * Every non-speech cue passes through one master gain before the destination.
 * SPEC 9.5's graph is per tone; a shared trunk after it is what lets
 * `settings.audioEnabled` mute the whole channel in one place and keeps the
 * cue bus separate from the TTS path (SPEC 9.1: the two are never mixed).
 */
export const CUE_MASTER_GAIN = 0.9;

/**
 * A brick wall on the cue bus. Mutation sonification (9.8) is the first thing
 * that plays several voices at once — up to eight point tones, three swell
 * voices and five ticks can overlap — and Web Audio sums them arithmetically,
 * so peaks add and the destination hard-clips. The threshold sits above a
 * single tone's peak (0.18), so one tone at a time passes through untouched and
 * only a genuine pile-up is limited. Same reasoning as TTS_LIMITER, different
 * bus.
 */
export const CUE_LIMITER = {
  thresholdDb: -6,
  kneeDb: 0,
  ratio: 20,
  attackSec: 0.002,
  releaseSec: 0.12,
} as const;

// ---------------------------------------------------------------------------
// SPEC 9.8 — mutation sonification (F-17), and the generative layer HD-10 adds
// ---------------------------------------------------------------------------

/** SPEC 9.8 step 3: at most 8 added elements are sonified, sorted y then x. */
export const MUTATION_POINT_CAP = 8;

/** SPEC 9.8 step 4: point tones are 70 ms apart, tighter than the scan's 90 ms. */
export const MUTATION_POINT_SPACING_MS = 70;

/** SPEC 9.8 step 4: quieter than a scan, because this is ambient, not focal. */
export const MUTATION_GAIN_MULTIPLIER = 0.6;

/**
 * SPEC 9.8 step 6: at most one burst per 1200 ms. Not optional — a polling
 * widget otherwise produces the continuous noise this project exists to avoid.
 */
export const MUTATION_RATE_LIMIT_MS = 1200;

/**
 * Text churn (characterData edits, text nodes appearing) never reaches the
 * element index, so it has no `index.changed` to ride on and needs its own
 * flush. Longer than the index observer's 150 ms debounce on purpose: when a
 * mutation changes both the text and the set of controls, the index diff
 * arrives first and cancels this timer, so the burst carries the points rather
 * than spending the rate limit on the churn that preceded them.
 */
export const MUTATION_CHURN_DEBOUNCE_MS = 220;

/**
 * The observer callback runs on the page's hot path and may receive thousands
 * of records at once. It reads no layout and runs no query; it only counts, and
 * it stops counting past this many records. Beyond a few hundred the burst is
 * already "huge" and the exact number changes nothing you can hear.
 */
export const MUTATION_RECORD_SCAN_CAP = 256;

/**
 * Added elements kept for geometry. `getBoundingClientRect` forces layout, so
 * it is called at most this many times, and only at flush time, which the rate
 * limit already holds to once per 1200 ms.
 */
export const MUTATION_GEOMETRY_SAMPLE_CAP = 8;

/**
 * The floor under which a mutation is not worth a sound. A spinner swapping in,
 * a class toggling, one label rewriting itself: below this the page has not
 * materially changed, and firing would spend the 1200 ms rate limit on nothing
 * — which is how the real event 800 ms later ends up silent.
 */
export const MUTATION_MIN_ADDED_ELEMENTS = 2;
export const MUTATION_MIN_TEXT_CHANGES = 2;

/** Descendants counted per sampled element when sizing a swell. Bounded work. */
export const MUTATION_SUBTREE_COUNT_CAP = 200;

// --- The swell: large structural additions (HD-10) --------------------------

/** Below this many added elements there is nothing to swell about; points only. */
export const SWELL_MIN_ELEMENTS = 4;

/** Added elements (subtree-weighted) that count as "the whole view rebuilt". */
export const SWELL_FULL_SCALE_ELEMENTS = 48;

/**
 * Roots for the swell, high to low: the bigger the addition, the deeper the
 * note. A2, G2, E2, D2, C2, A1 — an A minor pentatonic descent, so a swell is
 * consonant with the 220 Hz A that SPEC 9.3's `freq(y)` is built on and two
 * swells in a row are an interval rather than a collision. Sawtooth voices,
 * not sine: the harmonics carry the pitch on small drivers where a 55 Hz
 * fundamental is inaudible.
 */
export const SWELL_ROOTS_HZ = [110, 98, 82.41, 73.42, 65.41, 55] as const;

/** Swell length, interpolated by magnitude. A big change takes longer to arrive. */
export const SWELL_DURATION_MS = { min: 380, max: 900 } as const;

/** Fraction of the swell spent rising. Slow attack is what makes it a swell. */
export const SWELL_ATTACK_RATIO = 0.45;

/** Peak gain, interpolated by magnitude. Under a point tone's 0.18: this is the bed. */
export const SWELL_PEAK_GAIN = { min: 0.045, max: 0.105 } as const;

/** Detune between the two saw voices, in cents. Enough to beat, not enough to sound out of tune. */
export const SWELL_DETUNE_CENTS = 7;

/** Resonance on the sweeping lowpass. The "cybernetic" part of the timbre. */
export const SWELL_FILTER_Q = 7;

/**
 * The cutoff sweep, as multiples of the root: it opens from just above the
 * fundamental to the top multiple over the attack, then settles back. A rising
 * resonant cutoff is the materializing gesture; the top multiple is
 * interpolated by magnitude, so a bigger change opens brighter.
 */
export const SWELL_FILTER_START_MULTIPLE = 1.25;
export const SWELL_FILTER_PEAK_MULTIPLE = { min: 6, max: 14 } as const;
export const SWELL_FILTER_SETTLE_MULTIPLE = 2;

/**
 * The sine that sits under the saws at the same root, as a fraction of the
 * swell's peak gain. It replaces the fundamental the resonant lowpass takes
 * out; an octave lower would be 27.5 Hz at the deepest root, which nothing on
 * a laptop reproduces.
 */
export const SWELL_BODY_GAIN_RATIO = 0.55;

/** Half-width of the two saw voices around the mutation's centroid, at full spread. */
export const SWELL_WIDTH_MAX = 0.35;

// --- The ticks: text churn (HD-10) -----------------------------------------

/** At most this many ticks per burst, however much text changed. */
export const CHURN_TICK_MAX = 5;

/** Tighter than the point spacing: these are a flurry, not a sequence. */
export const CHURN_TICK_SPACING_MS = 28;

/** Short enough to read as a click rather than a note. */
export const CHURN_TICK_DURATION_MS = 18;

/** Quiet. Text churn is the most frequent event on a live page. */
export const CHURN_TICK_PEAK_GAIN = 0.045;

/**
 * A6, C7, E7, G7 — the same A minor pentatonic as the swell roots, four octaves
 * up, played as an ascending arpeggio. A square wave through a high-Q bandpass
 * at these frequencies is a struck-glass sound, which is what "crystalline"
 * means here; the pitch set is what stops a flurry sounding like a fault.
 */
export const CHURN_TICK_FREQS_HZ = [1760, 2093.0, 2637.02, 3135.96] as const;

/** Bandpass resonance for a tick. High: this is a resonator, not a filter. */
export const CHURN_TICK_FILTER_Q = 12;

/** Ring buffer of scheduled cues kept for tests and inspection. */
export const AUDIO_LOG_CAPACITY = 128;

// ---------------------------------------------------------------------------
// SPEC 11.4 — resolver response handling
// ---------------------------------------------------------------------------

/** SPEC 11.4 rule 2: abort the request via AbortController at 2500 ms. No retry. */
export const MODEL_TIMEOUT_MS = 2500;

/** SPEC 11.4 rule 1: a 5xx gets one retry after 300 ms, then fails. */
export const MODEL_5XX_RETRY_DELAY_MS = 300;

/** SPEC 11.4 rule 1: exactly one retry on 5xx. 429 and timeouts get none. */
export const MODEL_5XX_MAX_RETRIES = 1;

/**
 * SPEC 11.4 rule 1 gives the 429 sentence as "The model is rate limited."; that
 * read the API's status text aloud, which users heard as a fault (DEV-007). The
 * behaviour (no retry, fall back to local candidates or fail) is unchanged; only
 * the words differ. The technical detail is logged, never spoken.
 */
export const MODEL_BUSY_SPOKEN_MESSAGE = "I'm busy right now. Try again in a moment.";

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

/** chrome.storage.session key: id of the tab where the last key.down happened (where the command runs). */
export const ACTIVE_TAB_KEY = "activeTab";

/**
 * chrome.storage.session flag, honoured by development builds only (compiled out of
 * production, SPEC 17.3): while true the service worker logs but otherwise ignores
 * recognizer results and errors, so an e2e run is not at the mercy of what a real,
 * network-dependent speech service happens to hear.
 */
export const QA_IGNORE_STT_KEY = "qa.ignoreStt";

/** SPEC 7.7: delay between the steps of a bounded multi-action batch. */
export const SEQUENCE_STEP_DELAY_MS = 250;

/**
 * The "still working" tick (SPEC 9.1 keeps tones and speech apart, so it only
 * plays while the service worker waits on the model, never during speech): the
 * first one after this long, so an instant local resolution stays silent ...
 */
export const PROCESSING_TICK_FIRST_MS = 500;
/** ... then one per interval ... */
export const PROCESSING_TICK_INTERVAL_MS = 800;
/** ... at most this many (the model timeout is 2500 ms plus one 300 ms retry). */
export const PROCESSING_TICK_MAX = 6;

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

/**
 * Human-directed replacement for the SPEC 6.18 bookmark row (DEV-006): "save
 * this page" opens Google Keep with the page title and URL as the note text.
 * Compile-time constant like SEARCH_TEMPLATE; never derived from page content or
 * model output. `%s` is replaced with the encodeURIComponent'd note text.
 */
export const KEEP_NOTE_TEMPLATE = "https://keep.google.com/#NOTE/?text=%s";

/** Longest search query or tab name that is read aloud back to the user. */
export const GLOBAL_SPOKEN_NAME_MAX_CHARS = 40;

/** Minimum similarity (0..1) for "switch to X tab" to pick a tab. */
export const TAB_MATCH_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// SPEC 11.6 / 11.7 — page summary and question answering
// ---------------------------------------------------------------------------

/** SPEC 11.6: page text sent for a summary. */
export const PAGE_TEXT_SUMMARY_MAX_CHARS = 12_000;

/** SPEC 11.7: page text sent for a question. */
export const PAGE_TEXT_QA_MAX_CHARS = 30_000;

/**
 * Timeout for the summary / Q&A call. SPEC 11.4's 2500 ms bounds the resolver, whose
 * request is a few KB; this call carries up to 30 000 characters and returns prose (DEV-008).
 */
export const QA_TIMEOUT_MS = 8000;

/** SPEC 11.7: maxOutputTokens for an answer. Summaries get a little more room. */
export const QA_MAX_OUTPUT_TOKENS = 200;
export const SUMMARY_MAX_OUTPUT_TOKENS = 300;

/** Words allowed in a spoken answer, by verbosity (SPEC 11.6 / 11.7). */
export const QA_MAX_WORDS = { fast: 40, verbose: 80 } as const;
export const SUMMARY_MAX_WORDS = { fast: 45, verbose: 90 } as const;

/** How long a "do X, then tell me about the result" waits for the page to finish loading. */
export const NAVIGATION_WAIT_MS = 6000;

/** Most tabs described to the model, and the longest tab title sent. */
export const CONTEXT_MAX_TABS = 20;
export const CONTEXT_TITLE_MAX_CHARS = 80;

// ---------------------------------------------------------------------------
// SPEC 10.6 & HD-A06 — TTS & ElevenLabs constants
// ---------------------------------------------------------------------------

/** HD-A06: ElevenLabs ultra-low latency model ID (~75ms latency requirement). */
export const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_flash_v2_5";

/** HD-A06: ElevenLabs default voice ID (George). */
export const DEFAULT_ELEVENLABS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";

/**
 * Explicit voice settings for every ElevenLabs request.
 *
 * Sending none makes the API apply the voice's stored defaults
 * (stability 0.5, similarity_boost 0.75, style 0, use_speaker_boost true),
 * which open an utterance over-emphatically and loud before settling.
 *
 *   stability 0.65      — above the 0.5 default, so the delivery does not
 *                         over-perform the opening clause. Not higher: past
 *                         ~0.75 the read goes monotone.
 *   similarity_boost 0.6 — below the 0.75 default; high adherence to the
 *                         reference recording is what drags in its artifacts.
 *   style 0             — no style exaggeration. Non-zero also costs latency.
 *   use_speaker_boost false — the boost raises level and hardens the attack,
 *                         and costs latency, which HD-A06 budgets at ~75ms.
 */
export const ELEVENLABS_VOICE_SETTINGS = {
  stability: 0.65,
  similarity_boost: 0.6,
  style: 0,
  use_speaker_boost: false,
} as const;

/**
 * Peak gain for decoded ElevenLabs speech. Unity: the clip is already mastered,
 * and attenuating it here only made the body quiet without touching the loud
 * opening, because a static gain scales peaks and body by the same factor.
 * Taming the opening is the limiter's job, below.
 */
export const TTS_PLAYBACK_GAIN = 1.0;

/**
 * Limiter applied to decoded speech before it reaches the destination.
 *
 * Utterances open hot — the model over-drives the first clause, and MP3 decoding
 * adds inter-sample overshoot on top, so the opening seconds exceed unity and
 * the output stage hard-clips them. That clipping is the crackle; it is not
 * present in the rest of the clip, which sits at a normal level.
 *
 * A compressor fixes what a gain could not: it acts only above the threshold, so
 * the hot opening is pulled down while normal speech passes untouched.
 *
 *   threshold -4 dB — normal TTS speech peaks below this and is not affected.
 *   ratio 20, knee 0 — a brick wall, not a compressor: this is peak safety.
 *   attack 3 ms     — fast enough to catch a plosive, slow enough not to dull it.
 *   release 250 ms  — long enough that the gain does not pump between syllables.
 */
export const TTS_LIMITER = {
  thresholdDb: -4,
  kneeDb: 0,
  ratio: 20,
  attackSec: 0.003,
  releaseSec: 0.25,
} as const;

/** Fade in over this long so the buffer does not hard-start into a click. */
export const TTS_FADE_IN_MS = 90;

/** Fade out over this long on interruption, so a stop does not click (SPEC 10.6.4). */
export const TTS_FADE_OUT_MS = 40;

/**
 * SPEC 10.6.2: chrome.tts playback rate. Used both for the configured local
 * engine and for the last-resort speak, which previously inlined it twice.
 */
export const DEFAULT_TTS_RATE = 1.6;

/** SPEC 10.6.3: {name} is truncated to 40 characters for speech. */
export const CONFIRMATION_NAME_MAX_CHARS = 40;

/** SPEC 10.6.2: utterances longer than 200 characters are split into sentences. */
export const TTS_CHUNK_MAX_CHARS = 200;


// ---------------------------------------------------------------------------
// F-22 Synthetic text detection (GPTZero) — HD-13 / DEV-011
// ---------------------------------------------------------------------------

/**
 * GPTZero's text classifier. POST, API key in the `x-api-key` header, never in
 * the query string — the same rule the Gemini key follows (SPEC 8.6).
 */
export const GPTZERO_ENDPOINT = "https://api.gptzero.me/v2/predict/text";

/**
 * The detector runs alongside the browser-context gather, ahead of the answer
 * call, so its budget has to fit inside the gap a summary already has. A late
 * verdict is dropped, never waited for: the answer must not be slower because
 * the classifier was (CLAUDE.md 14, "protect the chain").
 */
export const GPTZERO_TIMEOUT_MS = 2500;

/**
 * Page text sent for classification. Well inside GPTZero's document limit, and
 * enough of a sample that the verdict is about the page rather than its header.
 */
export const GPTZERO_MAX_CHARS = 20_000;

/**
 * Below this, no verdict is produced at all. Detectors are unreliable on short
 * text, and a false "this is A.I." on a page of nav links is worse than silence:
 * it teaches the user to ignore the warning that matters.
 */
export const GPTZERO_MIN_CHARS = 350;

/**
 * P(ai) at or above this is spoken as "most of this page". Deliberately high.
 * The warning is only useful while it stays rare.
 */
export const GPTZERO_HIGH_THRESHOLD = 0.8;

/** P(ai) at or above this is spoken as "parts of this page". Below it, nothing is said. */
export const GPTZERO_MIXED_THRESHOLD = 0.5;

/**
 * A document GPTZero itself classes as MIXED warns from a lower score: it has
 * found AI passages inside human text, which is the case the whole-document
 * probability understates.
 */
export const GPTZERO_MIXED_CLASS_THRESHOLD = 0.35;

/**
 * Verdicts kept, keyed by a hash of the sampled text. A second question about
 * the same page costs nothing and takes no time.
 */
export const GPTZERO_CACHE_MAX_ENTRIES = 50;

/**
 * HD-14: a paragraph at or above this is flagged on its own, whatever the
 * document as a whole scored. This is the case a single page-level number
 * hides — a human article with one machine-written section inserted into it.
 */
export const GPTZERO_PARAGRAPH_THRESHOLD = 0.7;

/**
 * A paragraph shorter than this is not judged at all.
 *
 * This is not a way of suppressing warnings, it is a limit on what can honestly
 * be classified: a caption, a nav item or a one-line pull quote carries too
 * little signal, and a detector asked about it returns noise. Without the gate,
 * "any paragraph over 70%" turns into fifty chances to trip on a fifty-paragraph
 * page, and a warning that fires on everything means nothing.
 */
export const GPTZERO_PARAGRAPH_MIN_CHARS = 250;

/**
 * How many flagged paragraphs it takes to warn. **One**, per HD-14 — the human
 * chose the most sensitive setting deliberately. If real pages prove noisy,
 * this is the one number to raise, and `GPTZERO_PARAGRAPH_MIN_CHARS` is the
 * second.
 */
export const GPTZERO_MIN_FLAGGED_PARAGRAPHS = 1;

/**
 * Eligibility fallback when the response scores paragraphs but carries no
 * sentence text to measure them with: three sentences is a paragraph, one is a
 * caption. Used only when a character count is genuinely unavailable.
 */
export const GPTZERO_PARAGRAPH_MIN_SENTENCES = 3;

/** Flagged excerpts quoted into the prompt, and how much of each. Page text: capped and sanitized. */
export const GPTZERO_EXCERPT_MAX_CHARS = 120;
export const GPTZERO_MAX_EXCERPTS = 4;

/**
 * Spoken before the answer, never instead of it. "A.I." rather than "AI" so
 * both TTS engines say the letters (SPEC 10.6.2). The wording is the human's
 * from HD-14: the point is not that a detector fired, it is what to do about it.
 */
export const SYNTHETIC_WARNING_SENTENCES = {
  high: "Heads up: most of this page reads as A.I. generated text. Watch out for misinformation or incorrect details.",
  mixed: "Heads up: parts of this page read as A.I. generated text. Watch out for misinformation.",
} as const;

/** HD-14: the document read as human, but a section of it did not. */
export function flaggedSectionWarning(count: number): string {
  if (count === 1) {
    return "Heads up: one section of this page reads as A.I. generated. Watch out for misinformation there.";
  }
  return `Heads up: ${count} sections of this page read as A.I. generated. Watch out for misinformation.`;
}
