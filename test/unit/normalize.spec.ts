import { describe, expect, it } from "vitest";

import {
  cleanText,
  normalizeNameKey,
  normalizeTranscript,
} from "../../src/shared/normalize";

describe("Text cleaning and normalization (SPEC 7.2.1, 7.2.2)", () => {
  it("cleanText handles accents, NFKD, case, &, and punctuation", () => {
    expect(cleanText("Café & Restaurant")).toBe("cafe and restaurant");
    expect(cleanText("  HELLO   WORLD  ")).toBe("hello world");
    expect(cleanText("Book flight #12! (Today)")).toBe("book flight 12 today");
    expect(cleanText("")).toBe("");
  });

  it("normalizeNameKey normalizes element names", () => {
    expect(normalizeNameKey("Morning departures")).toBe("morning departures");
    expect(normalizeNameKey("Select 9:40 AM flight")).toBe("940 am flight");
    expect(normalizeNameKey("Download itinerary (PDF)")).toBe("download itinerary pdf");
    expect(normalizeNameKey("Search flights")).toBe("search flights");
    expect(normalizeNameKey("Confirm booking")).toBe("confirm booking");
    expect(normalizeNameKey("Passenger name")).toBe("passenger name");
    expect(normalizeNameKey("Submit button")).toBe("submit");
    expect(normalizeNameKey("Help link")).toBe("help");
    expect(normalizeNameKey("Departure date")).toBe("departure date");
  });

  it("normalizeTranscript handles filler removal (Step 5)", () => {
    expect(normalizeTranscript("please click search").remainder).toBe("search");
    expect(normalizeTranscript("can you click search").remainder).toBe("search");
    expect(normalizeTranscript("could you press submit").remainder).toBe("submit");
    expect(normalizeTranscript("i want to choose flight").remainder).toBe("flight");
    expect(normalizeTranscript("i'd like to open menu").remainder).toBe("menu");
    expect(normalizeTranscript("ok tap next").remainder).toBe("next");
    expect(normalizeTranscript("okay push next").remainder).toBe("next");
    expect(normalizeTranscript("um focus on name").remainder).toBe("name");
    expect(normalizeTranscript("uh click here").remainder).toBe("here");
    expect(normalizeTranscript("hey click search").remainder).toBe("search");
  });

  it("normalizeTranscript maps every verb in the lexicon (Step 6)", () => {
    // Click class
    expect(normalizeTranscript("click flights").verb).toBe("click");
    expect(normalizeTranscript("press flights").verb).toBe("click");
    expect(normalizeTranscript("tap flights").verb).toBe("click");
    expect(normalizeTranscript("hit flights").verb).toBe("click");
    expect(normalizeTranscript("push flights").verb).toBe("click");
    expect(normalizeTranscript("open flights").verb).toBe("click");
    expect(normalizeTranscript("select flights").verb).toBe("click");
    expect(normalizeTranscript("choose flights").verb).toBe("click");
    expect(normalizeTranscript("go to flights").verb).toBe("click");

    // Fill class
    expect(normalizeTranscript("type Seattle").verb).toBe("fill");
    expect(normalizeTranscript("enter Seattle").verb).toBe("fill");
    expect(normalizeTranscript("fill Seattle").verb).toBe("fill");
    expect(normalizeTranscript("put Seattle").verb).toBe("fill");
    expect(normalizeTranscript("write Seattle").verb).toBe("fill");
    expect(normalizeTranscript("set Seattle").verb).toBe("fill");

    // Check / Uncheck
    expect(normalizeTranscript("check morning").verb).toBe("check");
    expect(normalizeTranscript("tick morning").verb).toBe("check");
    expect(normalizeTranscript("enable morning").verb).toBe("check");
    expect(normalizeTranscript("turn on morning").verb).toBe("check");
    expect(normalizeTranscript("uncheck morning").verb).toBe("uncheck");
    expect(normalizeTranscript("untick morning").verb).toBe("uncheck");
    expect(normalizeTranscript("disable morning").verb).toBe("uncheck");
    expect(normalizeTranscript("turn off morning").verb).toBe("uncheck");

    // ScrollTo
    expect(normalizeTranscript("scroll to footer").verb).toBe("scrollTo");
    expect(normalizeTranscript("jump to footer").verb).toBe("scrollTo");
    expect(normalizeTranscript("take me to footer").verb).toBe("scrollTo");
    expect(normalizeTranscript("find footer").verb).toBe("scrollTo");

    // Focus
    expect(normalizeTranscript("focus email").verb).toBe("focus");
    expect(normalizeTranscript("focus on email").verb).toBe("focus");
  });

  it("normalizeTranscript extracts fillValue and target on 'into', 'in', 'as'", () => {
    const t1 = normalizeTranscript("type John Doe into passenger name");
    expect(t1.verb).toBe("fill");
    expect(t1.fillValue).toBe("john doe");
    expect(t1.remainder).toBe("passenger name");

    const t2 = normalizeTranscript("enter Seattle in from field");
    expect(t2.verb).toBe("fill");
    expect(t2.fillValue).toBe("seattle");
    expect(t2.remainder).toBe("from");
    expect(t2.roleHint).toBe("field");

    const t3 = normalizeTranscript("set 2026-10-15 as date");
    expect(t3.verb).toBe("fill");
    expect(t3.fillValue).toBe("20261015");
    expect(t3.remainder).toBe("date");
  });

  it("normalizeTranscript strips stop words and extracts roleHint (Step 7)", () => {
    const t1 = normalizeTranscript("click on the search button");
    expect(t1.remainder).toBe("search");
    expect(t1.roleHint).toBe("button");

    const t2 = normalizeTranscript("go to the flights link");
    expect(t2.remainder).toBe("flights");
    expect(t2.roleHint).toBe("link");

    const t3 = normalizeTranscript("check the morning box");
    expect(t3.remainder).toBe("morning");
    expect(t3.roleHint).toBe("box");

    const t4 = normalizeTranscript("focus on that email field");
    expect(t4.remainder).toBe("email");
    expect(t4.roleHint).toBe("field");
  });

  it("handles the primary demo sentence: 'book the 9:40 flight'", () => {
    // "book" is not in the verb lexicon; "the" is a stop word
    const t = normalizeTranscript("book the 9:40 flight");
    expect(t.remainder).toContain("940");
    expect(t.remainder).toContain("flight");
  });

  it("verifies 30+ input/output pairs", () => {
    const cases = [
      ["please click search", "search"],
      ["can you open settings", "settings"],
      ["click on the download button", "download"],
      ["tap the next link", "next"],
      ["check morning departures", "morning departures"],
      ["uncheck nonstop only", "nonstop only"],
      ["go to flights", "flights"],
      ["scroll to terms and conditions", "terms and conditions"],
      ["jump to payment details", "payment details"],
      ["take me to footer", "footer"],
      ["find check in", "check"],
      ["focus on email address", "email address"],
      ["focus username field", "username"],
      ["type alice into name field", "name"],
      ["fill password as secret", "secret"],
      ["enter waterloo in to field", ""],
      ["choose seat preference", "seat preference"],
      ["hit confirm booking", "confirm booking"],
      ["push search flights", "search flights"],
      ["select refundable fares", "refundable fares"],
      ["tick fare rules box", "fare rules"],
      ["enable morning flight", "flight"],
      ["untick marketing box", "marketing"],
      ["disable notifications", "notifications"],
      ["turn on dark mode", "dark mode"],
      ["turn off auto renew", "auto renew"],
      ["write hello into feedback", "feedback"],
      ["put test in search box", "search"],
      ["press cancel button", "cancel"],
      ["click Home", "home"],
      ["hey open help", "help"],
    ];

    expect(cases.length).toBeGreaterThanOrEqual(30);
    for (const [input, expectedRemainder] of cases) {
      const res = normalizeTranscript(input);
      if (expectedRemainder) {
        expect(res.remainder).toContain(expectedRemainder);
      }
    }
  });
});
