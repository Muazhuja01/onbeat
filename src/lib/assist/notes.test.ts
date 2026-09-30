import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/memory/store";
import type { Note } from "@/lib/types";
import { noteForRequest, pickAssistNotes, quickPhrasesForRequest } from "./notes";

const note = (id: string, text: string, extra: Partial<Note> = {}): Note => ({ id, kind: "routine", text, entities: [], updatedAt: 0, ...extra });

describe("pickAssistNotes", () => {
  it("sends every note, about-me first, when they fit", async () => {
    const m = await MemoryStore.create();
    await m.replaceAll([note("b", "I swim on Mondays."), note("me", "I'm Maya.", { kind: "about-me", pinned: true })], []);
    expect((await pickAssistNotes(m, ["hello"])).map((n) => n.id)).toEqual(["me", "b"]);
  });

  it("sends the about-me note and related notes within 12,000 characters when there are too many", async () => {
    const m = await MemoryStore.create();
    const many = Array.from({ length: 60 }, (_, i) => note(`n${i}`, `Note ${i} about gardening ${"x".repeat(250)}`));
    await m.replaceAll([note("me", "I'm Maya.", { kind: "about-me", pinned: true }), note("physio", "I have physio on Tuesdays at 10:30."), ...many], []);
    const picked = await pickAssistNotes(m, ["My physio moved."]);
    expect(picked[0].id).toBe("me");
    expect(picked.map((n) => n.id)).toContain("physio");
    expect(picked.reduce((n, x) => n + x.text.length, 0)).toBeLessThanOrEqual(12_000);
  });

  it("sends at most 200 notes, each cut to 300 characters, counting the budget on the cut text", async () => {
    const m = await MemoryStore.create();
    const tiny = Array.from({ length: 250 }, (_, i) => note(`t${i}`, `Tiny ${i}.`));
    await m.replaceAll([note("me", "I'm Maya.", { kind: "about-me", pinned: true }), ...tiny], []);
    const few = await pickAssistNotes(m, ["Tiny 3"]);
    expect(few.length).toBeLessThanOrEqual(200);
    expect(few[0].id).toBe("me");

    // 30 notes of 500 characters: 15,000 in full, 9,000 once cut, so all are sent.
    const long = Array.from({ length: 30 }, (_, i) => note(`l${i}`, `Long ${i} ${"x".repeat(492)}`));
    await m.replaceAll(long, []);
    const picked = await pickAssistNotes(m, ["hello"]);
    expect(picked).toHaveLength(30);
    expect(Math.max(...picked.map((n) => noteForRequest(n).text.length))).toBe(300);
  });
});

describe("quickPhrasesForRequest", () => {
  it("names who or where each quick phrase is for", async () => {
    const m = await MemoryStore.create();
    await m.replaceAll([{ id: "sam", kind: "person", text: "Sam: the barista.", entities: ["Sam"], updatedAt: 0 }], []);
    await m.addQuickPhrase("My usual, please.", { partnerId: "sam" });
    await m.addQuickPhrase("I type to talk.", {});
    expect(quickPhrasesForRequest(m).map(({ text, for: f }) => ({ text, for: f }))).toEqual(
      expect.arrayContaining([{ text: "My usual, please.", for: "Sam" }, { text: "I type to talk.", for: undefined }]),
    );
  });

  it("sends at most 100, those for a sent note first, then the newest, cut to fit", async () => {
    const m = await MemoryStore.create();
    const sam: Note = { id: "sam", kind: "person", text: "Sam: the barista.", entities: ["S".repeat(200)], updatedAt: 0 };
    const phrases = Array.from({ length: 150 }, (_, i) => ({
      id: `p${i}`,
      text: i === 0 ? `Phrase 0 ${"z".repeat(1990)}` : `Phrase ${i}.`,
      context: { timeOfDay: "morning" as const, ...(i < 5 ? { partnerId: "sam" } : {}) },
      timesUsed: 0,
      lastUsed: i,
      quick: true as const,
    }));
    await m.replaceAll([sam], phrases);
    const sent = quickPhrasesForRequest(m, new Set(["sam"]));
    expect(sent).toHaveLength(100);
    expect(sent.slice(0, 5).map((p) => p.id)).toEqual(["p4", "p3", "p2", "p1", "p0"]);
    expect(sent[5].id).toBe("p149");
    expect(sent[4].text).toHaveLength(120);
    expect(sent[0].for).toHaveLength(80);
    // With no sent note to prefer, the newest.
    expect(quickPhrasesForRequest(m, new Set()).slice(0, 2).map((p) => p.id)).toEqual(["p149", "p148"]);
  });
});
