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
  it("ignores sentence-initial capitals that aren't days or months", () => {
    expect(extractClaims("Large, please.")).toEqual([]);
    expect(extractClaims("Coffee sounds good. Thanks!")).toEqual([]);
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
