# Aria

A Chrome extension that lets you operate a web page by voice, with the screen off.

Screen readers read a page top to bottom. If the button you want is at the bottom, you go through everything above it first. Aria skips that. You hold a key, say what you want in plain English, and it does it.

Built at Hack the North 2026.

## Setting it up

You need Node 20 or newer and pnpm.

```bash
pnpm install
pnpm build
```

That puts the extension in `dist/`. To load it:

1. Go to `chrome://extensions`
2. Turn on Developer mode (top right)
3. Click "Load unpacked" and pick the `dist/` folder

You'll see Aria in the list. Click "Details", then "Extension options".

## API keys

Paste your keys into the options page and **click Save Settings at the bottom**. The page doesn't autosave, and the "Test key on a sample" button checks a key without saving it, so it's easy to think you've saved when you haven't.

| Key | Needed? | What you lose without it |
| --- | --- | --- |
| Gemini | Yes, mostly | Commands the local matcher can't figure out, plus summaries and questions. Simple clicks and browser commands still work. |
| ElevenLabs | No | Falls back to Chrome's built-in voice, which works fine but sounds robotic. |
| GPTZero | No | No warnings about AI-generated pages. Everything else is unaffected. |

Nothing is sent anywhere without a key. If you leave GPTZero blank, no page text ever goes to them.

## Microphone

The first time you use it, Aria opens a tab asking for microphone access. Say yes. This only happens once. Chrome won't let an extension's background worker ask for the mic directly, which is why it needs the extra tab.

## Using it

**Hold Space, talk, let go.** Hold it down the whole time you're speaking. A quick tap gets ignored on purpose, so you don't fire off commands by accident while typing.

Things you can say:

```
Click the download button
Fill in John Doe
Check non-stop only
Select the 9:40 AM flight
Scroll to the payment section
```

Several things at once, in one sentence:

```
Fill in John Doe, then check refundable fares, and then click Search flights
```

Ask about the page:

```
Summarize this page
What does this say about refunds?
Where am I?
```

Move around the browser. These never touch the network, so they're instant:

```
Search for Hack the North
Go back
Next tab
Switch to the Wikipedia tab
New tab
Close tab
Reload
Save this
```

### When it isn't sure

If you say "click download" and there are two Download buttons, Aria won't guess. It highlights both and asks which one you meant. Say "the first one" or "the second one". If you don't answer within 15 seconds it forgets about it and goes back to idle.

This is deliberate. If you can't see the screen, a wrong click is much worse than being asked a question.

### AI content warnings

With a GPTZero key set, Aria scores a page's text before reading it to you. It checks each paragraph, not just the page as a whole, because a real article with one machine-written section stuck in the middle will score fine overall. If any paragraph comes back above 70% machine-written, you hear something like:

> "Heads up: one section of this page reads as A.I. generated. Watch out for misinformation there."

Pages that read as human-written say nothing extra. That's on purpose too. A warning that fires on everything stops meaning anything.

If GPTZero is slow, rate-limited, or down, you get no warning and the summary plays normally. It never blocks anything.

## Trying it without a real website

There's a demo page, a fake airline booking site:

```bash
pnpm demo
```

Then open `http://localhost:5173`. Good for testing because it has the awkward stuff real sites have: duplicate button names, a form that rebuilds itself, results that load in after a delay.

## Running the tests

```bash
pnpm verify
```

Builds, typechecks, lints, then runs the unit, DOM and end-to-end suites. The end-to-end tests drive a real Chrome with the extension loaded and a fake microphone, so they take about eight minutes.

Individual pieces:

```bash
pnpm test          # unit + DOM, fast
pnpm test:e2e      # Playwright, slow
pnpm typecheck
pnpm lint
```

If you want to check your GPTZero key from the command line:

```bash
setx GPT_ZERO "your-key"   # then open a new terminal
pnpm gate:gptzero
```

That runs a machine-written sample, a human-written one, and a human article with an AI section spliced in, and prints what the detector made of each.

## How it's put together

Three separate environments, because Manifest V3 forces them apart:

- **Offscreen document** owns the microphone and speech recognition. Service workers aren't allowed near media devices.
- **Service worker** decides what you meant. A local fuzzy matcher handles most commands with no network call. Anything it isn't confident about goes to Gemini, along with a sanitized list of what's on the page. The model only ever names an element we already indexed. It never sees a URL and never returns a selector.
- **Content script** does the clicking and typing. It fires real `input` and `change` events so React and Vue notice them, and re-checks the element right before acting. If the page moved underneath it, it stops instead of clicking the wrong thing.

`SPEC.md` has the full detail if you want it.

## Known limits

- Chrome only. It leans on Manifest V3 offscreen documents and the Web Speech API.
- Speech recognition goes through Chrome's service, so it needs a connection.
- Some pages don't expose useful accessible names for their controls, and Aria can only work with what's there.
