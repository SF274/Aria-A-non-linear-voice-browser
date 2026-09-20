/**
 * Readable page text for the summary and Q&A calls — SPEC 11.6 step 2, 8.4.
 *
 *   - document.title
 *   - h1..h3 text in document order
 *   - the main landmark's text, or the body's when there is no main
 *   - everything sanitizeForPrompt'd, whitespace collapsed, capped at maxChars
 *
 * The URL is not part of it. Text is data for a plain-text call whose output is
 * only ever spoken (SPEC 8.5); nothing here reaches the element resolver.
 */

import { sanitizeForPrompt, sanitizeForPromptKeepingBreaks } from "../shared/normalize";

export interface PageTextOptions {
  /**
   * HD-14: keep the blank lines between blocks instead of collapsing them.
   *
   * The Q&A prompt does not care — `buildAnswerRequestBody` re-sanitizes and
   * collapses whatever it is given — but the synthetic-text classifier segments
   * paragraphs on those breaks, and without them a whole page arrives as one
   * paragraph and per-paragraph detection has nothing to work with.
   */
  preserveParagraphs?: boolean;
}

export interface PageText {
  title: string;
  /** Title, headings, then body text, ready to place in a prompt. */
  text: string;
  truncated: boolean;
}

const HIDDEN_SELECTOR = "script,style,noscript,template,svg,iframe,[hidden],[aria-hidden='true']";
const MAX_HEADINGS = 40;

/** What a reader would see: innerText where the browser has it, a stripped clone elsewhere. */
function visibleText(root: Element): string {
  const withInner = root as HTMLElement;
  if (typeof withInner.innerText === "string") return withInner.innerText;
  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll(HIDDEN_SELECTOR).forEach((n) => n.remove());
  return clone.textContent ?? "";
}

export function extractPageText(doc: Document, maxChars: number, options: PageTextOptions = {}): PageText {
  const clean = options.preserveParagraphs ? sanitizeForPromptKeepingBreaks : sanitizeForPrompt;
  const title = sanitizeForPrompt(doc.title ?? "", 200);

  const headings: string[] = [];
  doc.querySelectorAll("h1,h2,h3").forEach((h) => {
    if (headings.length >= MAX_HEADINGS || h.closest(HIDDEN_SELECTOR)) return;
    const t = sanitizeForPrompt(visibleText(h), 200);
    if (t) headings.push(t);
  });

  const root = doc.querySelector("main,[role='main']") ?? doc.body;
  const body = root ? clean(visibleText(root)) : "";

  const head = [title && `Title: ${title}`, headings.length > 0 && `Headings: ${headings.join(" | ")}`]
    .filter(Boolean)
    .join("\n");
  const full = [head, body && `Content: ${body}`].filter(Boolean).join("\n");

  const text = full.slice(0, Math.max(0, maxChars));
  return { title, text, truncated: full.length > text.length };
}
