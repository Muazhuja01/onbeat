import { describe, expect, it } from "vitest";
import { claimSupported, extractClaims, isNearDuplicate, validateReply, type ValidationSources } from "./validate";

const sources = (over: Partial<ValidationSources> = {}): ValidationSources => ({
  notes: new Map([
    ["sam", "Sam is the barista at Blue Door Café."],
    ["physio", "I have physio on Tuesdays at 10.30."],
    ["zoe", "Zoe O\u2019Brien is my neighbour."],
  ]),
  partnerSaid: "",
  typed: "",
  ...over,
});

describe("extractClaims", () => {
  it("finds names after the first word, numbers, times and days", () => {
    expect(extractClaims("Thanks Sam, see you Friday at 9:30.")).toEqual(["9:30", "Sam", "Friday"]);
  });
  it("ignores everyday words at the start of a sentence", () => {
    expect(extractClaims("Large, please.")).toEqual([]);
    expect(extractClaims("Coffee sounds good. Thanks!")).toEqual([]);
    expect(extractClaims("Much better, thanks.")).toEqual([]);
    expect(extractClaims("Here it is.")).toEqual([]);
  });
  it("checks an unusual word at the start of a sentence as a possible name", () => {
    expect(extractClaims("Jen helped me set it up.")).toEqual(["Jen"]);
    expect(extractClaims("Sure. Priya said so.")).toEqual(["Priya"]);
  });
  it("always checks days and months, even first in a sentence", () => {
    expect(extractClaims("Monday works.")).toEqual(["Monday"]);
  });
  it("does not treat I or OK as names", () => {
    expect(extractClaims("Yes, I think OK is fine and I'm happy.")).toEqual([]);
  });
});

describe("claimSupported", () => {
  it("matches names ignoring accents, case and apostrophe style", () => {
    expect(claimSupported("Café", "blue door cafe")).toBe(true);
    expect(claimSupported("Zoë", "Zoe is here")).toBe(true);
    expect(claimSupported("O'Brien", "Zoe O\u2019Brien")).toBe(true);
  });
  it("matches possessives", () => {
    expect(claimSupported("Sam's", "Sam is the barista")).toBe(true);
  });
  it("matches times written with a dot or colon", () => {
    expect(claimSupported("10:30", "physio at 10.30")).toBe(true);
    expect(claimSupported("11:30", "physio at 10.30")).toBe(false);
  });
});

describe("validateReply", () => {
  it("accepts a reply whose details come from cited notes", () => {
    expect(validateReply({ text: "Hi Sam, my usual please.", noteIds: ["sam"] }, sources())).toEqual({ ok: true });
  });
  it("rejects an unknown note id", () => {
    expect(validateReply({ text: "Hi!", noteIds: ["ghost"] }, sources())).toEqual({ ok: false, reason: "unknown-note", detail: "ghost" });
  });
  it("rejects a name that no source mentions", () => {
    expect(validateReply({ text: "Say hi to Priya for me.", noteIds: [] }, sources())).toEqual({
      ok: false,
      reason: "unsupported-detail",
      detail: "Priya",
    });
  });
  it("requires the note to be cited, not just sent", () => {
    expect(validateReply({ text: "Thanks, Sam.", noteIds: [] }, sources()).ok).toBe(false);
  });
  it("accepts details from what the partner said or what the user typed", () => {
    expect(validateReply({ text: "Yes, Friday works.", noteIds: [] }, sources({ partnerSaid: "Is Friday OK?" })).ok).toBe(true);
    expect(validateReply({ text: "See you at 4.", noteIds: [] }, sources({ typed: "4" })).ok).toBe(true);
  });
  it("rejects an invented time", () => {
    expect(validateReply({ text: "My physio is at 11:30.", noteIds: ["physio"] }, sources()).ok).toBe(false);
  });
  it("handles accented and apostrophe names from notes", () => {
    expect(validateReply({ text: "Tell Zoë O'Brien I said hi.", noteIds: ["zoe"] }, sources()).ok).toBe(true);
  });
});

describe("isNearDuplicate", () => {
  it("catches identical and nearly identical replies", () => {
    expect(isNearDuplicate("Large, please.", "large please")).toBe(true);
    expect(isNearDuplicate("A large latte, please.", "A large latte please thanks")).toBe(true);
  });
  it("keeps different replies", () => {
    expect(isNearDuplicate("Large, please.", "What sizes do you have?")).toBe(false);
  });
});

describe("number words", () => {
  it("treats number words as claims, but not 'one'", () => {
    expect(extractClaims("Two, please. Just one more.")).toEqual(["two"]);
    expect(extractClaims("See you at noon.")).toEqual(["noon"]);
  });

  it("backs number words with digits and plain digits with number words", () => {
    expect(claimSupported("two", "I have 2 dogs")).toBe(true);
    expect(claimSupported("2", "two blocks from home")).toBe(true);
    expect(claimSupported("noon", "Lunch at 12:00")).toBe(true);
    expect(claimSupported("three", "I have 2 dogs")).toBe(false);
    expect(claimSupported("2:30", "two blocks from home")).toBe(false);
  });

  it("drops an invented quantity", () => {
    expect(validateReply({ text: "I'd like three, please.", noteIds: [] }, sources({ partnerSaid: "How many?" }))).toMatchObject({
      ok: false,
      detail: "three",
    });
  });
});

describe("relative days", () => {
  // From the eval (tom-16): nothing in the notes or the conversation mentions tomorrow.
  it("drops an invented tomorrow", () => {
    const s = sources({
      notes: new Map([["t-meds", "I pick up my blood pressure medication at Riverside Pharmacy every month."]]),
      partnerSaid: "Is there anything else you need?",
      context: "It is Tuesday morning. Place: Riverside Pharmacy. Talking with: Priya.",
    });
    expect(validateReply({ text: "Could you confirm the pickup time for tomorrow?", noteIds: ["t-meds"] }, s)).toMatchObject({
      ok: false,
      detail: "tomorrow",
    });
    expect(extractClaims("Yesterday was fine. See you tonight.")).toEqual(["Yesterday", "tonight"]);
  });
  it("accepts a relative day the partner mentioned, and never checks today", () => {
    expect(validateReply({ text: "Sure, tomorrow works for me.", noteIds: [] }, sources({ partnerSaid: "Can we move our meeting to tomorrow?" })).ok).toBe(true);
    expect(extractClaims("Not today, thanks.")).toEqual([]);
  });
});

describe("context line as a source", () => {
  it("accepts the current partner, place and weekday without a cited note", () => {
    const s = sources({ notes: new Map(), context: "It is Tuesday morning. Place: Blue Door Café. Talking with: Sam." });
    expect(validateReply({ text: "Morning Sam, happy Tuesday.", noteIds: [] }, s).ok).toBe(true);
  });
});

describe("titles and relative times", () => {
  it("checks the name after a title", () => {
    expect(extractClaims("Ask Dr. Patel about it.")).toContain("Patel");
    expect(validateReply({ text: "Ask Dr. Patel about it.", noteIds: [] }, sources()).ok).toBe(false);
  });

  it("checks relative time phrases and backs them from the conversation", () => {
    expect(extractClaims("Maybe I'll skip it this week.")).toContain("this week");
    expect(validateReply({ text: "Maybe I'll skip it this week.", noteIds: [] }, sources()).ok).toBe(false);
    expect(validateReply({ text: "Yes, this week works.", noteIds: [] }, sources({ partnerSaid: "Are you free this week?" })).ok).toBe(true);
    expect(validateReply({ text: "Later today works.", noteIds: [] }, sources({ partnerSaid: "Can we talk later today?" })).ok).toBe(true);
  });

  it("drops an invented name at the start of a sentence and keeps a backed one", () => {
    expect(validateReply({ text: "Jen helped me set it up.", noteIds: [] }, sources()).ok).toBe(false);
    expect(validateReply({ text: "Sam knows my order.", noteIds: ["sam"] }, sources()).ok).toBe(true);
  });
});

describe("everyday openers and titles", () => {
  it("does not treat a common reply opener as a name", () => {
    const openers = [
      "Cheers", "Yup", "Nah", "Bye", "Goodbye", "Congrats", "Honestly", "Whatever", "Hope", "Hopefully", "Might", "Need",
      "Anyone", "Everyone", "Nobody", "Enough", "Afternoon", "Evening", "Indeed", "Sweet", "Stop", "Slowly", "Tired",
      "Hungry", "Thirsty", "Unfortunately", "Basically", "Anytime", "Depends", "Kind", "Sadly", "Yay", "Oops", "Ugh",
      "Lol", "Ooh", "Whoa", "Uh", "Mm", "Aw", "Ta", "Thx", "Sorry", "Please", "Yes", "Okay", "Fine", "Great", "Sure",
      "Hello", "Hi", "Hey", "Lovely", "Perfect", "Brilliant", "Wonderful", "Ouch", "Hmm", "Huh", "Night", "Wait",
    ];
    expect(openers.length).toBeGreaterThanOrEqual(60);
    for (const w of openers) expect(extractClaims(`${w}, thanks.`), w).toEqual([]);
  });
  it("does not treat a title as a name", () => {
    expect(extractClaims("Dr. Chen said so.")).toEqual(["Chen"]);
  });
  it("matches time phrases on word boundaries", () => {
    expect(claimSupported("this week", "Are you free this weekend?")).toBe(false);
    expect(claimSupported("this week", "Are you free this  week?")).toBe(true);
    expect(claimSupported("this week", "Free this week.")).toBe(true);
  });
});
