import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/memory/store";
import type { Note } from "@/lib/types";
import { pickAssistNotes, quickPhrasesForRequest } from "./notes";

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
});
