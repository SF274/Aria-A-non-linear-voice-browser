# Aria - A non-linear voice browser

**Elevator pitch:**
Screen readers read the web in a straight line. Aria skips the line: hold a key, say what you want in plain English, and the page does it. Eyes closed.

---

## Inspiration

Have you ever watched someone navigate the web with a standard screen reader? They're forced to experience a 2D page as a 1D string of text. To reach a single "Checkout" button they might press Tab fifty times, through the nav bar, the cookie banner, and three sidebars.

Making someone *find* a button when they already know exactly what they want is a failure of UX. We wanted to let them skip the tabbing and talk straight to the DOM.

## What it does

Aria is a Chrome extension that turns the web into a non-linear, voice-driven experience.

* **Hold-to-talk execution.** Hold Space, say *"Click the download PDF button,"* release. Aria finds that element and clicks it. Multi-step works in one breath: *"Check non-stop only, then check refundable fares, and then click Search flights."*
* **It asks instead of guessing.** Say "Download" with two identical Download buttons on the page and Aria doesn't gamble. It highlights both and asks *"The first one or the second one?"* For a user who can't see what just got clicked, a wrong action costs far more than a question.
* **AI-content warnings.** Before reading a page aloud, Aria scores its text with GPTZero — **every paragraph, not just the page**. Any paragraph over 70% machine-written triggers a spoken heads-up first. A sighted reader squints at a sketchy layout and gets suspicious; with the screen off, that signal doesn't exist. This gives it back.
* **Ask the page anything.** *"Summarize this page"* or *"What does this say about refunds?"* — answered from the page's own text, never guessed.
* **Browser control with zero network calls.** *"Search for Hack the North," "Go back," "Next tab," "Save this."* All matched locally. No model, no latency.
* **A voice worth listening to.** We used **ElevenLabs** Flash v2.5 for speech, with `chrome.tts` as an offline fallback. When someone can't see the screen, the voice isn't a layer on top of the product — it *is* the product. A flat robotic reader is tiring after ten minutes, let alone a full working day, so natural prosody isn't polish here. It's whether someone can stand to use this all day.

## How we built it

A Manifest V3 extension split into three isolated environments:

* **The Ears (offscreen document).** MV3 service workers can't touch media devices, so a hidden offscreen document owns the `getUserMedia` stream and the Web Speech API, with a fresh recognition instance per utterance.
* **The Brain (service worker).** A two-tier resolver. Tier 1 is a local fuzzy matcher over the accessibility tree that resolves **80% of commands with no network call at all** (16 of 20 in our scripted gate). Only what it can't resolve confidently goes to `gemini-3.1-flash-lite`, and only as a sanitized subset of the page. The model never sees a URL, never returns a CSS selector, and its output can't do anything but name an element ID we already indexed.
* **The Hands (content script).** An executor built on `aria-query` that fires native `input` and `change` events with `bubbles: true`, so React and Vue value trackers actually register them.

## Challenges we ran into

* **Chrome's microphone rules.** Getting mic permission inside an MV3 offscreen document is genuinely painful. We had to build a one-time permission tab that writes a flag to `chrome.storage` before the state machine can even initialize.
* **Stale DOM nodes.** Sites re-render constantly. We'd target a button and React would swap the node out before the click landed. Fixed with a re-resolution step immediately before execution: if the element moved more than 0.15 normalized units, the action aborts rather than clicking whatever's now in that spot.
* **A safety feature that failed into silence.** Our AI detector had a 2.5-second budget, copied from the resolver. But the resolver sends a few KB of element names and the detector sends a whole article. It kept timing out, returning no verdict — and "no verdict" looked *exactly* like "this page is fine." A warning system that fails silently is worse than none, so we widened the budget and shrank the sample.
* **Sanitization quietly broke paragraph detection.** Our prompt sanitizer collapses all whitespace, which meant GPTZero received one undifferentiated blob and returned one paragraph. Per-paragraph scoring was running perfectly on a single paragraph. We had to preserve the line breaks on that one path only.

## Accomplishments that we're proud of

* **Low latency.** Most commands are resolved locally with no network call at all, so there's no round trip to sit through. You speak, and the page moves.
* **It asks instead of guessing**, preventing errors and dangerous mistakes.
* **Multi-step commands in a single sentence.** "Do this, then this, then this" works the way you'd actually say it out loud.
* **Speech that's comfortable for hours**, not minutes, which matters when the voice is your only interface.
* **It genuinely works.** We'd use it ourselves, screen off.

## What we learned

The DOM accessibility tree is far deeper than we expected — computing an element's name means walking a fallback chain through `aria-labelledby`, `aria-label`, `title`, and inner text, and getting it wrong means a command resolves to the wrong control.

The bigger lesson was about failure modes. Twice we built something that broke *silently* and looked identical to working correctly. For an accessibility tool, where the user can't visually verify what happened, a silent failure is the most dangerous kind of bug there is.

## What's next for Aria

Cross-tab context (*"Find the tracking number in my email and paste it here"*), an audio layout scan that maps the page's structure to tones so users can hear the shape of a page before engaging with it, and custom voice macros for the apps people use every day.
