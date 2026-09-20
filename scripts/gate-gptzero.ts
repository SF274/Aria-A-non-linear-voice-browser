/**
 * Gate script for F-22 / HD-14: GPTZero response shape and threshold calibration.
 * Run with: GPT_ZERO=... pnpm gate:gptzero
 *
 * This exists because two things about this feature were designed without ever
 * being observed. The docs host renders with JavaScript and fetches empty, so
 * the *success* response shape was never seen — only a 403 confirming the URL,
 * the method and the `x-api-key` header. And the thresholds are reasoned
 * defaults that have never met a real page.
 *
 * So the script answers exactly those two questions, and nothing else:
 *
 *   1. **Which fields actually arrive?** It prints the top-level keys of
 *      `documents[0]`, and whether `paragraphs[]` and `sentences[]` are there
 *      and what shape their entries have. If `paragraphs[]` is absent, the
 *      per-paragraph rule is running on sentence runs and that should be known.
 *   2. **Where do real texts fall?** It classifies a machine-written sample and
 *      a human-written one, prints the document score, every eligible section's
 *      score, and the verdict our own parser produces for each. A human sample
 *      that comes back flagged is the false-positive risk made concrete.
 *
 * It is a diagnostic, not a pass/fail gate on a number: it exits non-zero only
 * when the parser produces no verdict at all, which means the shape moved.
 *
 * The key is read from the environment because it is a script-only variable, the
 * same arrangement as `COHERE_API_KEY` in `.env.example`. Nothing under `src/`
 * reads it; the extension itself takes its key from the options page (SPEC 8.6).
 */

import { GPTZERO_ENDPOINT, GPTZERO_PARAGRAPH_THRESHOLD } from "../src/shared/constants";
import { extractSections, formatAuthenticity, parseVerdict, warningSentenceFor } from "../src/sw/gptzero/detect";

/** Unmistakably machine written: the register, the hedging, the empty superlatives. */
const AI_SAMPLE = `In today's rapidly evolving digital landscape, businesses must leverage innovative solutions to stay ahead of the curve. By harnessing the power of cutting-edge technology, organizations can unlock unprecedented opportunities for growth and drive meaningful transformation across every facet of their operations.

It is important to note that a comprehensive approach, one that carefully balances efficiency with scalability, remains essential for long-term success. Furthermore, by fostering a culture of continuous improvement, companies can ensure that they remain well positioned to navigate the challenges that lie ahead.

Ultimately, the key to sustained growth lies in embracing change while maintaining a steadfast commitment to excellence. Organizations that prioritize adaptability and innovation will find themselves better equipped to thrive in an increasingly competitive and interconnected global marketplace.`;

/** Public-domain human prose (Melville, Moby-Dick, ch. 1). Old enough to be nobody's training-set artefact. */
const HUMAN_SAMPLE = `Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world. It is a way I have of driving off the spleen and regulating the circulation.

Whenever I find myself growing grim about the mouth; whenever it is a damp, drizzly November in my soul; whenever I find myself involuntarily pausing before coffin warehouses, and bringing up the rear of every funeral I meet; and especially whenever my hypos get such an upper hand of me, that it requires a strong moral principle to prevent me from deliberately stepping into the street, and methodically knocking people's hats off—then, I account it high time to get to sea as soon as I can.

This is my substitute for pistol and ball. With a philosophical flourish Cato throws himself upon his sword; I quietly take to the ship. There is nothing surprising in this. If they but knew it, almost all men in their degree, some time or other, cherish very nearly the same feelings towards the ocean with me.`;

/** A human article with a machine-written section dropped into the middle: the case HD-14 is about. */
const MIXED_SAMPLE = `${HUMAN_SAMPLE.split("\n\n")[0]}

In today's rapidly evolving digital landscape, maritime organizations must leverage innovative solutions to stay ahead of the curve. By harnessing the power of cutting-edge navigational technology, seafaring enterprises can unlock unprecedented opportunities for growth and drive meaningful transformation across every facet of their operations, ensuring long-term scalability and success.

${HUMAN_SAMPLE.split("\n\n")[2]}`;

interface Doc {
  paragraphs?: unknown;
  sentences?: unknown;
  [k: string]: unknown;
}

async function classify(apiKey: string, document: string): Promise<string> {
  const response = await fetch(GPTZERO_ENDPOINT, {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ document, multilingual: false }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return response.text();
}

function describeShape(body: string): void {
  let doc: Doc | undefined;
  try {
    doc = (JSON.parse(body) as { documents?: Doc[] }).documents?.[0];
  } catch {
    console.log("  [shape] body is not JSON");
    return;
  }
  if (!doc) {
    console.log("  [shape] no documents[0] in the response");
    return;
  }
  console.log(`  [shape] documents[0] keys: ${Object.keys(doc).join(", ")}`);
  for (const field of ["paragraphs", "sentences"] as const) {
    const value = doc[field];
    if (!Array.isArray(value)) {
      console.log(`  [shape] ${field}: ABSENT  <-- the per-paragraph rule is not using it`);
      continue;
    }
    const first = value[0] as Record<string, unknown> | undefined;
    console.log(
      `  [shape] ${field}: ${value.length} entries; entry keys: ${first ? Object.keys(first).join(", ") : "(empty)"}`
    );
  }
}

async function run(apiKey: string, label: string, sample: string, expectFlagged: boolean): Promise<boolean> {
  console.log(`\n=== ${label} (${sample.length} chars) ===`);
  let body: string;
  try {
    body = await classify(apiKey, sample);
  } catch (err) {
    console.error(`  REQUEST FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }

  describeShape(body);

  const verdict = parseVerdict(body, sample.length);
  if (!verdict) {
    console.error("  PARSER PRODUCED NO VERDICT — the response shape has moved. Raw body follows:");
    console.error(body.slice(0, 1500));
    return false;
  }

  const doc = (JSON.parse(body) as { documents?: Doc[] }).documents?.[0] ?? {};
  const sections = extractSections(doc, sample.length);
  console.log(
    `  document: ${(verdict.aiProbability * 100).toFixed(1)}% ai` +
      `${verdict.classification ? ` (${verdict.classification})` : ""}`
  );
  console.log(`  sections found: ${sections.length}; eligible: ${verdict.paragraphsConsidered}`);
  sections.forEach((s, i) => {
    const over = s.aiProbability >= GPTZERO_PARAGRAPH_THRESHOLD ? "  <-- OVER THRESHOLD" : "";
    console.log(
      `    [${i + 1}] ${(s.aiProbability * 100).toFixed(1)}%  ${s.chars ?? "?"} chars  ` +
        `${s.sentences} sentences${over}`
    );
  });
  console.log(`  verdict level: ${verdict.level}; flagged: ${verdict.flagged.length}`);
  console.log(`  spoken: ${warningSentenceFor(verdict) ?? "(nothing)"}`);
  console.log(`  prompt block: ${formatAuthenticity(verdict).slice(0, 400)}`);

  const flagged = verdict.flagged.length > 0;
  if (flagged !== expectFlagged) {
    console.log(
      `  >>> CALIBRATION NOTE: expected ${expectFlagged ? "at least one flagged section" : "no flagged sections"}, got ${verdict.flagged.length}.`
    );
  }
  return true;
}

async function main(): Promise<void> {
  const apiKey = process.env.GPT_ZERO;
  if (!apiKey) {
    console.error("Error: GPT_ZERO environment variable is required.");
    console.error('Usage:  setx GPT_ZERO "<key>"   (then open a new shell)');
    console.error("   or:  add GPT_ZERO=<key> to .env  (already gitignored)");
    console.error("   or:  GPT_ZERO=<key> pnpm gate:gptzero");
    process.exit(1);
  }

  console.log(`[F-22] paragraph flag threshold: ${GPTZERO_PARAGRAPH_THRESHOLD * 100}%`);

  const ok = [
    await run(apiKey, "MACHINE-WRITTEN SAMPLE (expect flagged)", AI_SAMPLE, true),
    await run(apiKey, "HUMAN-WRITTEN SAMPLE (expect clean — this is the false-positive check)", HUMAN_SAMPLE, false),
    await run(apiKey, "MIXED SAMPLE (human article, one machine section — the HD-14 case)", MIXED_SAMPLE, true),
  ];

  if (ok.some((r) => !r)) {
    console.error("\nFAIL: at least one sample could not be classified or parsed.");
    process.exit(1);
  }
  console.log("\nPASS: all three samples classified and parsed. Read the calibration notes above.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
