import { describe, expect, it } from "vitest";
import { summarizeAssist, type AssistCaseResult } from "./score";

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
