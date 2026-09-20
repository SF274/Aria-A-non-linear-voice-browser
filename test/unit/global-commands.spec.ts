/**
 * Global commands — SPEC 6.18, TASKS T1-08 (F-15): the intent router and the
 * chrome.tabs work behind it. HD-04: search is Google. DEV-006: "save this
 * page" opens Google Keep.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fillTemplate,
  matchGlobalIntent,
  matchTab,
  runGlobalIntent,
  scoreTab,
  type GlobalIntent,
  type TabLike,
} from "../../src/sw/commands/browser";
import { ACTIVE_TAB_KEY, KEEP_NOTE_TEMPLATE, SEARCH_TEMPLATE } from "../../src/shared/constants";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

describe("matchGlobalIntent (SPEC 6.18: fixed intent table, matched before element resolution)", () => {
  const positives: Array<[string, GlobalIntent]> = [
    ["new tab", { kind: "new_tab" }],
    ["open a new tab", { kind: "new_tab" }],
    ["Open new tab.", { kind: "new_tab" }],
    ["please open a new tab", { kind: "new_tab" }],
    ["open another tab", { kind: "new_tab" }],
    ["close tab", { kind: "close_tab" }],
    ["close this tab", { kind: "close_tab" }],
    ["Close the current tab.", { kind: "close_tab" }],
    ["next tab", { kind: "cycle_tab", direction: 1 }],
    ["go to the next tab", { kind: "cycle_tab", direction: 1 }],
    ["previous tab", { kind: "cycle_tab", direction: -1 }],
    ["switch to the last tab", { kind: "cycle_tab", direction: -1 }],
    ["go back", { kind: "history", direction: "back" }],
    ["Go back a page.", { kind: "history", direction: "back" }],
    ["go forward", { kind: "history", direction: "forward" }],
    ["reload", { kind: "reload" }],
    ["refresh the page", { kind: "reload" }],
    ["reload this page", { kind: "reload" }],
    ["switch to gmail tab", { kind: "switch_tab", query: "gmail" }],
    ["switch to the Stack Overflow tab", { kind: "switch_tab", query: "Stack Overflow" }],
    ["go to youtube tab", { kind: "switch_tab", query: "youtube" }],
    ["jump to the tab called docs", { kind: "switch_tab", query: "docs" }],
    ["search for cheap flights to Toronto", { kind: "search", query: "cheap flights to Toronto" }],
    ["Search for node.js streams.", { kind: "search", query: "node.js streams" }],
    ["search google for weather", { kind: "search", query: "weather" }],
    ["google search for pizza near me", { kind: "search", query: "pizza near me" }],
    ["look up hackathon projects", { kind: "search", query: "hackathon projects" }],
    ["save this page", { kind: "save_page" }],
    ["save page", { kind: "save_page" }],
    ["save to keep", { kind: "save_page" }],
    ["save this page to Google Keep", { kind: "save_page" }],
    ["bookmark this", { kind: "save_page" }],
    ["bookmark this page", { kind: "save_page" }],
    ["keep this page", { kind: "save_page" }],
  ];

  it.each(positives)("%j routes to %j", (transcript, expected) => {
    expect(matchGlobalIntent(transcript)).toEqual(expected);
  });

  // Anything that is a page command must fall through to the element resolver.
  const negatives = [
    "",
    "   ",
    "click search flights",
    "search flights", // the demo page's Search flights button
    "search",
    "search for", // nothing to search for
    "save", // a Save button
    "save changes",
    "keep", // no page reference
    "bookmark", // no page reference
    "click the new tab button",
    "close", // a dialog Close button
    "close dialog",
    "close the dialog",
    "back", // a page's Back button
    "forward",
    "next", // a wizard's Next button
    "go back to checkout",
    "go to checkout",
    "look up", // nothing to look up
    "book the 9:40 flight",
    "click confirm booking",
    "fill in john doe then click submit",
  ];

  it.each(negatives)("%j is not a global command", (transcript) => {
    expect(matchGlobalIntent(transcript)).toBeNull();
  });

  // No "tab" in the phrase: the router proposes a switch, and the pipeline only
  // takes it when an open tab really matches (otherwise it is a page command,
  // e.g. a "Switch to checkout" button). E2E suite G covers both outcomes.
  it.each([
    ["switch to checkout", "checkout"],
    ["Switch to Wikipedia.", "Wikipedia"],
    ["switch to the airport page", "airport"],
    ["switch back to the news site", "news"],
  ])("%j is a soft tab switch", (transcript, query) => {
    expect(matchGlobalIntent(transcript)).toEqual({ kind: "switch_tab", query, soft: true });
  });

  it("an explicit 'tab' is a hard switch, never soft", () => {
    expect(matchGlobalIntent("switch to the airport tab")).toEqual({ kind: "switch_tab", query: "airport" });
    expect(matchGlobalIntent("switch to next tab")).toEqual({ kind: "cycle_tab", direction: 1 });
  });
});

describe("fillTemplate", () => {
  it("encodes the text into the %s slot", () => {
    expect(fillTemplate(SEARCH_TEMPLATE, "cats & dogs?")).toBe(
      "https://www.google.com/search?q=cats%20%26%20dogs%3F"
    );
  });

  it("keeps replacement patterns like $& literal", () => {
    expect(fillTemplate("https://x/?q=%s", "$& $1")).toBe("https://x/?q=%24%26%20%241");
  });
});

// ---------------------------------------------------------------------------
// Tab matching
// ---------------------------------------------------------------------------

describe("matchTab (basic string similarity on title or URL)", () => {
  const tabs: TabLike[] = [
    { id: 1, title: "Flight Booking - Demo", url: "http://localhost:8080/index.html", lastAccessed: 10 },
    { id: 2, title: "Inbox (3) - me@gmail.com - Gmail", url: "https://mail.google.com/mail/u/0/", lastAccessed: 20 },
    { id: 3, title: "Stack Overflow - Where Developers Learn", url: "https://stackoverflow.com/", lastAccessed: 30 },
    { id: 4, title: "YouTube", url: "https://www.youtube.com/watch?v=abc", lastAccessed: 5 },
  ];

  it("finds a tab by a word in its title", () => {
    expect(matchTab("gmail", tabs)?.tab.id).toBe(2);
    expect(matchTab("stack overflow", tabs)?.tab.id).toBe(3);
    expect(matchTab("flight booking", tabs)?.tab.id).toBe(1);
  });

  it("finds a tab by its hostname when the title does not say it", () => {
    expect(matchTab("stackoverflow", tabs)?.tab.id).toBe(3);
    expect(matchTab("you tube", tabs)?.tab.id).toBe(4);
    expect(matchTab("localhost", tabs)?.tab.id).toBe(1);
  });

  it("returns null when nothing is close", () => {
    expect(matchTab("spreadsheet budget", tabs)).toBeNull();
  });

  it("breaks ties by most recently accessed tab", () => {
    const twins: TabLike[] = [
      { id: 7, title: "Docs", url: "https://a.example/", lastAccessed: 1 },
      { id: 8, title: "Docs", url: "https://b.example/", lastAccessed: 99 },
    ];
    expect(matchTab("docs", twins)?.tab.id).toBe(8);
  });

  it("ignores tabs without an id and scores an empty name as 0", () => {
    expect(matchTab("gmail", [{ title: "Gmail" }])).toBeNull();
    expect(scoreTab("", tabs[0])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Execution against a mocked chrome.tabs
// ---------------------------------------------------------------------------

interface ChromeMock {
  tabs: {
    create: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    goBack: ReturnType<typeof vi.fn>;
    goForward: ReturnType<typeof vi.fn>;
    reload: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
  windows: { update: ReturnType<typeof vi.fn> };
  storage: { session: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } };
}

const OPEN_TABS: Array<TabLike & { index: number }> = [
  { id: 11, index: 0, windowId: 1, title: "Flight Booking - Demo", url: "http://localhost:8080/index.html", lastAccessed: 50 },
  { id: 12, index: 1, windowId: 1, title: "Inbox - Gmail", url: "https://mail.google.com/", lastAccessed: 40 },
  { id: 14, index: 2, windowId: 1, title: "Weather", url: "https://weather.example/", lastAccessed: 20 },
  { id: 13, index: 0, windowId: 2, title: "Docs", url: "https://docs.example.com/", lastAccessed: 30 },
];

let chromeMock: ChromeMock;
let session: Record<string, unknown>;

function installChrome(activeTabId: number | null): void {
  session = activeTabId === null ? {} : { [ACTIVE_TAB_KEY]: activeTabId };
  chromeMock = {
    tabs: {
      create: vi.fn(async (props: unknown) => ({ id: 99, ...(props as object) })),
      remove: vi.fn(async () => undefined),
      goBack: vi.fn(async () => undefined),
      goForward: vi.fn(async () => undefined),
      reload: vi.fn(async () => undefined),
      update: vi.fn(async () => ({})),
      // Returned in scrambled order: cycling must sort by tab index itself.
      query: vi.fn(async (q: { active?: boolean; windowId?: number }) =>
        q.active
          ? [OPEN_TABS[0]]
          : [...OPEN_TABS].reverse().filter((t) => q.windowId === undefined || t.windowId === q.windowId)
      ),
      get: vi.fn(async (id: number) => {
        const tab = OPEN_TABS.find((t) => t.id === id);
        if (!tab) throw new Error("No tab with id");
        return tab;
      }),
    },
    windows: { update: vi.fn(async () => ({})) },
    storage: {
      session: {
        get: vi.fn(async (key: string) => (key in session ? { [key]: session[key] } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(session, items);
        }),
      },
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chromeMock;
}

describe("runGlobalIntent (chrome.tabs behaviour and the spoken sentence)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installChrome(11);
  });

  it("new tab: chrome.tabs.create({}) and says so", async () => {
    const r = await runGlobalIntent({ kind: "new_tab" });
    expect(chromeMock.tabs.create).toHaveBeenCalledExactlyOnceWith({});
    expect(r).toEqual({ ok: true, sentence: "Opening new tab." });
  });

  it("close tab: removes the tab the command was spoken in, then retargets speech", async () => {
    const r = await runGlobalIntent({ kind: "close_tab" });
    expect(chromeMock.tabs.remove).toHaveBeenCalledExactlyOnceWith(11);
    expect(r).toEqual({ ok: true, sentence: "Closing tab." });
    // The closed tab must not stay the speech target.
    expect(chromeMock.storage.session.set).toHaveBeenCalledWith({ [ACTIVE_TAB_KEY]: 11 });
    expect(chromeMock.tabs.query).toHaveBeenCalledWith({ active: true, windowId: 1 });
  });

  it("close tab: falls back to the active tab when nothing is remembered", async () => {
    installChrome(null);
    const r = await runGlobalIntent({ kind: "close_tab" });
    expect(chromeMock.tabs.remove).toHaveBeenCalledWith(11);
    expect(r.ok).toBe(true);
  });

  it("close tab: reports failure without throwing when the tab cannot be closed", async () => {
    chromeMock.tabs.remove.mockRejectedValueOnce(new Error("Tabs cannot be edited right now"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await runGlobalIntent({ kind: "close_tab" });
    expect(r).toEqual({ ok: false, sentence: "Something went wrong." });
  });

  it("next tab / previous tab: move within the window in tab order and wrap around", async () => {
    let r = await runGlobalIntent({ kind: "cycle_tab", direction: 1 });
    expect(chromeMock.tabs.query).toHaveBeenCalledWith({ windowId: 1 });
    expect(chromeMock.tabs.update).toHaveBeenLastCalledWith(12, { active: true });
    expect(r).toEqual({ ok: true, sentence: "Inbox - Gmail." });

    installChrome(11);
    r = await runGlobalIntent({ kind: "cycle_tab", direction: -1 });
    expect(chromeMock.tabs.update).toHaveBeenLastCalledWith(14, { active: true }); // wrapped to the end
    expect(session[ACTIVE_TAB_KEY]).toBe(14);
    expect(r.sentence).toBe("Weather.");
  });

  it("next tab with a single tab in the window says so", async () => {
    installChrome(13);
    const r = await runGlobalIntent({ kind: "cycle_tab", direction: 1 });
    expect(chromeMock.tabs.update).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: false, sentence: "There's no other tab." });
  });

  it("go back / go forward navigate the tab the command was spoken in", async () => {
    expect(await runGlobalIntent({ kind: "history", direction: "back" })).toEqual({ ok: true, sentence: "Going back." });
    expect(chromeMock.tabs.goBack).toHaveBeenCalledWith(11);
    expect(await runGlobalIntent({ kind: "history", direction: "forward" })).toEqual({
      ok: true,
      sentence: "Going forward.",
    });
    expect(chromeMock.tabs.goForward).toHaveBeenCalledWith(11);
  });

  it("go back with no history speaks the SPEC 6.18 sentence", async () => {
    chromeMock.tabs.goBack.mockRejectedValueOnce(new Error("Cannot find a next page in history."));
    expect(await runGlobalIntent({ kind: "history", direction: "back" })).toEqual({
      ok: false,
      sentence: "There's nothing to go back to.",
    });
    chromeMock.tabs.goForward.mockRejectedValueOnce(new Error("Cannot find a next page in history."));
    expect((await runGlobalIntent({ kind: "history", direction: "forward" })).sentence).toBe(
      "There's nothing to go forward to."
    );
  });

  it("reload reloads the tab the command was spoken in", async () => {
    expect(await runGlobalIntent({ kind: "reload" })).toEqual({ ok: true, sentence: "Reloading." });
    expect(chromeMock.tabs.reload).toHaveBeenCalledExactlyOnceWith(11);
  });

  it("switch to <name> tab: activates the best match, focuses its window, remembers it", async () => {
    const r = await runGlobalIntent({ kind: "switch_tab", query: "gmail" });
    expect(chromeMock.tabs.update).toHaveBeenCalledExactlyOnceWith(12, { active: true });
    expect(chromeMock.windows.update).toHaveBeenCalledWith(1, { focused: true });
    expect(session[ACTIVE_TAB_KEY]).toBe(12);
    expect(r).toEqual({ ok: true, sentence: "Switching to Inbox - Gmail." });
  });

  it("switch to a tab in another window focuses that window", async () => {
    await runGlobalIntent({ kind: "switch_tab", query: "docs" });
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(13, { active: true });
    expect(chromeMock.windows.update).toHaveBeenCalledWith(2, { focused: true });
  });

  it("switch to the tab you are already on does nothing", async () => {
    const r = await runGlobalIntent({ kind: "switch_tab", query: "flight booking" });
    expect(chromeMock.tabs.update).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, sentence: "You're already on Flight Booking - Demo." });
  });

  it("switch to an unknown tab names what it could not find and changes nothing", async () => {
    const r = await runGlobalIntent({ kind: "switch_tab", query: "spreadsheet budget" });
    expect(chromeMock.tabs.update).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: false, sentence: "I couldn't find a tab called spreadsheet budget." });
  });

  it("search: opens Google with the percent-encoded query (HD-04)", async () => {
    const r = await runGlobalIntent({ kind: "search", query: "cheap flights & hotels" });
    expect(chromeMock.tabs.create).toHaveBeenCalledExactlyOnceWith({
      url: "https://www.google.com/search?q=cheap%20flights%20%26%20hotels",
    });
    expect(r).toEqual({ ok: true, sentence: "Searching Google for cheap flights & hotels." });
  });

  it("search: a query that could smuggle URL syntax stays inside the q parameter", async () => {
    await runGlobalIntent({ kind: "search", query: "x&q=evil#frag" });
    const url = (chromeMock.tabs.create.mock.calls[0][0] as { url: string }).url;
    expect(new URL(url).origin).toBe("https://www.google.com");
    expect(new URL(url).searchParams.get("q")).toBe("x&q=evil#frag");
  });

  it("search: long queries are truncated in speech only, never in the URL", async () => {
    const query = "a".repeat(90);
    const r = await runGlobalIntent({ kind: "search", query });
    expect(r.sentence).toBe(`Searching Google for ${"a".repeat(40)}.`);
    expect((chromeMock.tabs.create.mock.calls[0][0] as { url: string }).url).toContain("a".repeat(90));
  });

  it("save this page: opens Keep with title and URL from the tab the command was spoken in", async () => {
    const r = await runGlobalIntent({ kind: "save_page" });
    const url = (chromeMock.tabs.create.mock.calls[0][0] as { url: string }).url;
    expect(url).toBe(
      "https://keep.google.com/#NOTE/?text=" +
        encodeURIComponent("Flight Booking - Demo\nhttp://localhost:8080/index.html")
    );
    expect(url.startsWith(KEEP_NOTE_TEMPLATE.replace("%s", ""))).toBe(true);
    expect(r).toEqual({ ok: true, sentence: "Opening Keep with this page." });
  });

  it("save this page: works from the URL alone when the tab has no title", async () => {
    OPEN_TABS[0] = { ...OPEN_TABS[0], title: "" };
    try {
      await runGlobalIntent({ kind: "save_page" });
      const url = (chromeMock.tabs.create.mock.calls[0][0] as { url: string }).url;
      expect(url).toBe(
        "https://keep.google.com/#NOTE/?text=" + encodeURIComponent("http://localhost:8080/index.html")
      );
    } finally {
      OPEN_TABS[0] = { ...OPEN_TABS[0], title: "Flight Booking - Demo" };
    }
  });

  it("save this page: says so when the tab has no readable URL", async () => {
    chromeMock.tabs.get.mockResolvedValueOnce({ id: 11, title: "x" });
    const r = await runGlobalIntent({ kind: "save_page" });
    expect(chromeMock.tabs.create).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: false, sentence: "I can't read this page." });
  });

  it("no global command ever calls fetch (they never reach the model, SPEC 6.18)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      for (const kind of ["new_tab", "close_tab", "save_page", "reload"] as const) {
        await runGlobalIntent({ kind });
      }
      await runGlobalIntent({ kind: "cycle_tab", direction: 1 });
      await runGlobalIntent({ kind: "history", direction: "back" });
      await runGlobalIntent({ kind: "switch_tab", query: "gmail" });
      await runGlobalIntent({ kind: "search", query: "cats" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
