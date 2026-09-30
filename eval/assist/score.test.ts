import { describe, expect, it } from "vitest";
import { briefOnlyCards, statesTerm, summarizeAssist, type AssistCaseResult } from "./score";

const base: AssistCaseResult = {
  id: "a",
  model: "m",
  expected: [{ action: "edit", noteId: "m-physio", fact: "Physio moved to Thursdays." }],
  cards: [{ action: "edit", text: "I have physio on Thursdays at 10:30.", noteId: "m-physio" }],
  userMessages: 3,
  verdict: { leak: false, cards: [{ n: 1, keep: true, invented: [], matches: 1, sayable: null }] },
};

describe("summarizeAssist", () => {
  it("counts keep, invented, edits right, recall and messages", () => {
    const s = summarizeAssist([base]);
    expect(s).toMatchObject({ cases: 1, void: 0, shown: 1, keep: [1, 1], invented: [0, 1], editsRight: [1, 1], recall: [1, 1], medianUserMessages: 3 });
  });

  it("an edit on the wrong note is not right", () => {
    const s = summarizeAssist([{ ...base, cards: [{ ...base.cards[0], noteId: "m-books" }] }]);
    expect(s.editsRight).toEqual([0, 1]);
  });

  it("leaves out a case where the simulated user leaked a fact", () => {
    const s = summarizeAssist([{ ...base, verdict: { ...base.verdict!, leak: true } }]);
    expect(s).toMatchObject({ cases: 0, void: 1, shown: 0 });
  });

  it("counts sayable phrases", () => {
    const s = summarizeAssist([
      {
        ...base,
        expected: [],
        cards: [{ action: "phrase", text: "Please write it down." }],
        verdict: { leak: false, cards: [{ n: 1, keep: true, invented: [], matches: null, sayable: true }] },
      },
    ]);
    expect(s.sayable).toEqual([1, 1]);
  });
});

describe("brief-only check", () => {
  it("matches whole words, plurals, prefixes and dash spellings", () => {
    expect(statesTerm("Check-up with Dr. Chen", "check-up")).toBe(true);
    expect(statesTerm("my checkup", "check-up")).toBe(true);
    expect(statesTerm("Parent‑teacher meeting", "parent-teacher")).toBe(true);
    expect(statesTerm("He is limping", "limp*")).toBe(true);
    expect(statesTerm("She has spare keys", "key")).toBe(true);
    expect(statesTerm("my keyboard", "key")).toBe(false);
    expect(statesTerm("a banana", "Ana")).toBe(false);
  });

  it("flags a card that states a brief detail no user line has", () => {
    const lines = [
      { speaker: "user" as const, text: "I have a dentist appointment on Friday" },
      { speaker: "assistant" as const, text: "Is it a cleaning at Smile Dental?" },
      { speaker: "user" as const, text: "Yes, 3 pm." },
    ];
    const cards = [
      { action: "add" as const, text: "Friday 9 October, 3pm: dentist cleaning at Smile Dental." },
      { action: "add" as const, text: "Friday 9 October, 3pm: dentist." },
      { action: "phrase" as const, text: "I need breaks.", forName: "Smile Dental" },
    ];
    // The assistant's own line is no source: only what the user typed counts.
    expect(briefOnlyCards(cards, ["Smile Dental", "clean*", "break*", "dentist"], lines)).toEqual([["Smile Dental", "clean*"], [], ["Smile Dental", "break*"]]);
  });

  it("counts a flagged card as invented even when the judge found nothing", () => {
    const s = summarizeAssist([{ ...base, briefOnly: [["cleaning"]] }]);
    expect(s.invented).toEqual([1, 1]);
    expect(s.inventedByBriefCheck).toBe(1);
    const both = summarizeAssist([{ ...base, briefOnly: [["cleaning"]], verdict: { leak: false, cards: [{ n: 1, keep: false, invented: ["cleaning"], matches: null, sayable: null }] } }]);
    expect(both.invented).toEqual([1, 1]);
    expect(both.inventedByBriefCheck).toBe(0);
  });
});
