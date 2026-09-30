import { describe, expect, it } from "vitest";
import { assistCases } from "./cases";
import { assistJudgeMessages, judgeNotes, parseAssistVerdict, readVotes, shownCard, voteAssist } from "./judge";

describe("assist judge", () => {
  it("reads verdicts, with sayable only for phrases", () => {
    const text = '{"leak": false, "cards": [{"n": 1, "keep": true, "invented": [], "matches": 1, "sayable": null}, {"n": 2, "keep": false, "invented": ["20 mg"], "matches": null, "sayable": true}]}';
    expect(parseAssistVerdict(text, 2)).toEqual({
      leak: false,
      cards: [
        { n: 1, keep: true, invented: [], matches: 1, sayable: null },
        { n: 2, keep: false, invented: ["20 mg"], matches: null, sayable: true },
      ],
    });
    expect(parseAssistVerdict('{"cards": []}', 1)).toBeNull();
  });

  it("takes the majority", () => {
    const v = (keep: boolean, leak = false) => ({ leak, cards: [{ n: 1, keep, invented: [], matches: 1, sayable: null }] });
    expect(voteAssist([v(true), v(false), v(true, true)])).toEqual({ leak: false, cards: [{ n: 1, keep: true, invented: [], matches: 1, sayable: null }] });
  });
});

describe("shownCard", () => {
  const base = { id: "c", lineId: "l", sources: [], state: "open" as const };

  it("shows notes as the app would save them, keeping the note id for scoring", () => {
    expect(shownCard({ ...base, action: "add", draft: { kind: "person", name: "Ana", text: "My carer, weekday mornings 8 to 10." } })).toEqual({ action: "add", text: "Ana: My carer, weekday mornings 8 to 10." });
    expect(shownCard({ ...base, action: "edit", noteId: "m-physio", oldText: "I have physio on Tuesdays at 10:30.", draft: { kind: "routine", text: "I have physio on Thursdays at 10:30." } })).toEqual({
      action: "edit",
      text: "I have physio on Thursdays at 10:30.",
      oldText: "I have physio on Tuesdays at 10:30.",
      noteId: "m-physio",
    });
    expect(shownCard({ ...base, action: "remove", noteId: "a-jen", oldText: "Jen sits next to me." })).toEqual({ action: "remove", text: "Jen sits next to me.", noteId: "a-jen" });
  });

  it("shows a phrase with who it is for", () => {
    expect(shownCard({ ...base, action: "phrase", phrase: { text: "Is it ready?", forName: "Priya" } })).toEqual({ action: "phrase", text: "Is it ready?", forName: "Priya" });
    expect(shownCard({ ...base, action: "phrase", phrase: { text: "I need help." } })).toEqual({ action: "phrase", text: "I need help." });
  });
});

describe("judge input", () => {
  it("shows the quick phrases the person already has with their notes", () => {
    const c = assistCases.find((x) => x.id === "tom-have-it")!;
    const notes = judgeNotes(c);
    expect(notes).toContain("I'm allergic to penicillin.");
    expect(notes).toContain('Quick phrase for Priya: "Please write it down."');
    const [, user] = assistJudgeMessages({ today: "2026-10-05", brief: c.brief, notes, lines: [], expected: [], cards: [] });
    expect(user.content).toContain('- Quick phrase for Priya: "Please write it down."');
  });

  it("gives an untied quick phrase no name", () => {
    const c = { ...assistCases.find((x) => x.id === "tom-have-it")!, quick: [["I need help.", undefined]] as [string, string | undefined][] };
    expect(judgeNotes(c)).toContain('Quick phrase: "I need help."');
  });

  it("doesn't count a date worked out from today as invented", () => {
    const [, user] = assistJudgeMessages({ today: "2026-10-05", brief: "", notes: [], lines: [], expected: [], cards: [] });
    expect(user.content).toMatch(/follows from today's date or the date list is not invented/);
  });
});

describe("readVotes", () => {
  const answer = (invented: string[]) => JSON.stringify({ leak: false, cards: [{ n: 1, keep: true, invented, matches: null, sayable: null }] });
  const asker = (texts: string[]) => {
    let i = 0;
    return { ask: async () => texts[i++] ?? "", calls: () => i };
  };

  it("caches only answers that read, and asks again for a cached broken one", async () => {
    const cache: Record<string, string> = { v0: "" };
    const a = asker([answer([]), answer(["3:30pm"]), answer(["3:30pm"])]);
    const verdict = await readVotes(3, 1, { cache, key: (v) => `v${v}`, ask: a.ask });
    expect(a.calls()).toBe(3);
    expect(verdict.cards[0].invented).toEqual(["3:30pm"]);
    expect(Object.values(cache).every((t) => parseAssistVerdict(t, 1))).toBe(true);
  });

  it("throws, caching nothing broken, when a vote can't be read, so a 1-1 split never passes as the majority", async () => {
    const cache: Record<string, string> = {};
    const a = asker([answer(["3:30pm"]), "", answer([])]);
    await expect(readVotes(3, 1, { cache, key: (v) => `v${v}`, ask: a.ask })).rejects.toThrow("judge answer unreadable (vote 2 of 3)");
    expect(cache).toEqual({ v0: answer(["3:30pm"]) });
  });

  it("reuses readable cached answers without asking", async () => {
    const cache = { v0: answer([]) };
    const a = asker([]);
    await readVotes(1, 1, { cache, key: (v) => `v${v}`, ask: a.ask });
    expect(a.calls()).toBe(0);
  });
});
