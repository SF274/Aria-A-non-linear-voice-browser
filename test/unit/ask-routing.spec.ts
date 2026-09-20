import { describe, expect, it } from "vitest";
import { isShortQuestion, matchAsk } from "../../src/sw/commands/ask";

/**
 * The router decides "tell me" versus "do it". A wrong "do it" clicks something; a
 * wrong "tell me" only talks. The rules lean toward the command, and these tables
 * are the contract.
 */

describe("matchAsk: whole-page summaries", () => {
  it.each([
    "Summarize the page.",
    "summarise this page",
    "What's on this page?",
    "what is on the page",
    "whats on this screen",
    "What's on the airport page?",
    "Describe this page",
    "give me a summary",
    "Where am I?",
    "what page is this",
    "what am I looking at",
    "read me this article",
    "tell me about this page",
    "can you summarize this page",
    "could you please tell me what's on this page",
    "so what's on this page",
    "what's this",
  ])("%j is a summary", (transcript) => {
    const route = matchAsk(transcript);
    expect(route?.action).toBeNull();
    expect(route?.ask.kind).toBe("summary");
  });

  it("'summarize the page and tell me the main heading' is one summary request, not an action", () => {
    const route = matchAsk("summarize the page and tell me the main heading of what's on it");
    expect(route?.action).toBeNull();
    expect(route?.ask.kind).toBe("summary");
    expect(route?.ask.question).toContain("main heading");
  });
});

describe("matchAsk: questions", () => {
  it.each([
    "What is the main heading?",
    "who wrote this",
    "when does the flight leave",
    "where is the search box",
    "why is the total so high",
    "how much is the cheapest flight",
    "which flight is earliest",
    "is there a submit button",
    "are there any errors",
    "does this page have a search box",
    "do you see a login form",
    "tell me the price",
    "explain the fare rules",
    "can I use a coupon here",
  ])("%j is a page question", (transcript) => {
    const route = matchAsk(transcript);
    expect(route?.action).toBeNull();
    expect(route?.ask.kind).toBe("qa");
    expect(route?.ask.contextOnly).toBe(false);
  });
});

describe("matchAsk: commands are left to the element resolver", () => {
  it.each([
    "click the first link",
    "click search flights",
    "book the 9:40 flight",
    "fill in John Doe, click submit, and then click confirm booking",
    "select the 9:40 flight",
    "do the booking",
    "can you click submit",
    "could you please fill in the name",
    "would you press the confirm button",
    "click the summary button",
    "read the terms",
    "type what is your name into the search box",
    "scroll to the description",
    "save",
    "back",
    "",
    "   ",
  ])("%j is not a question", (transcript) => {
    expect(matchAsk(transcript)).toBeNull();
  });
});

describe("matchAsk: date, time and tabs are answered without reading the page", () => {
  it.each([
    "what time is it",
    "What's the time?",
    "what's the date",
    "what day is it",
    "what is today's date",
    "what tabs are open",
    "which tabs do I have",
    "how many tabs do I have open",
    "list my tabs",
    "what tab am I on",
    "which page am I on",
  ])("%j is context-only", (transcript) => {
    expect(matchAsk(transcript)?.ask.contextOnly).toBe(true);
  });

  it("a flight time is a question about the page, not the clock", () => {
    for (const q of ["what time is the flight", "what time does it depart", "what's the departure time"]) {
      expect(matchAsk(q)?.ask.contextOnly).toBe(false);
    }
  });
});

describe("matchAsk: an action followed by a question", () => {
  it("splits 'click the first link and tell me where it leads'", () => {
    const route = matchAsk("Click the first link and tell me where it leads.");
    expect(route?.action).toBe("Click the first link");
    expect(route?.ask.question).toBe("tell me where it leads");
    expect(route?.ask.kind).toBe("qa");
  });

  it.each([
    ["click the first link, then tell me what it says", "click the first link", "tell me what it says"],
    ["click the first link and then describe the page", "click the first link", "describe the page"],
    ["press submit and summarize what happened", "press submit", "summarize what happened"],
    ["can you click the first link and tell me where it goes", "click the first link", "tell me where it goes"],
    ["open the menu, and what options are there", "open the menu", "what options are there"],
  ])("%j", (transcript, action, question) => {
    const route = matchAsk(transcript);
    expect(route?.action).toBe(action);
    expect(route?.ask.question).toBe(question);
  });

  it("keeps the case of a value the user asked to type", () => {
    expect(matchAsk("fill in the name with John Doe and tell me what changed")?.action).toBe(
      "fill in the name with John Doe"
    );
  });

  it("does not split an ordinary sequence", () => {
    expect(matchAsk("fill in John Doe, click submit, and then click confirm")).toBeNull();
    expect(matchAsk("click one and click two")).toBeNull();
  });

  it("a switch-tab action can carry a question", () => {
    const route = matchAsk("switch to the airport tab and summarize it");
    expect(route?.action).toBe("switch to the airport tab");
    expect(route?.ask.kind).toBe("summary");
  });
});

describe("matchAsk: naming another tab", () => {
  it.each([
    ["summarize the airport tab", "airport"],
    ["what's on the Wikipedia page", "wikipedia"],
    ["what is the heading on the airport page", "airport"],
    ["describe the northbound air tab", "northbound air"],
  ])("%j asks about tab %j", (transcript, tabQuery) => {
    expect(matchAsk(transcript)?.ask.tabQuery).toBe(tabQuery);
  });

  it.each([
    "summarize the page",
    "what's on this page",
    "what's on the page",
    "what is the title of this page",
    "what is the price of the first flight on this page",
    "describe the current tab",
  ])("%j is about the current page", (transcript) => {
    expect(matchAsk(transcript)?.ask.tabQuery).toBeNull();
  });
});

describe("isShortQuestion (short ones may be an element's name, so local matching tries first)", () => {
  it("counts words", () => {
    expect(isShortQuestion("what's new")).toBe(true);
    expect(isShortQuestion("how it works")).toBe(true);
    expect(isShortQuestion("where is the submit button")).toBe(false);
  });
});
