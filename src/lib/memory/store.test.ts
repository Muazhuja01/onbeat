import { describe, expect, it } from "vitest";
import { MemoryStore, type Embedder } from "./store";
import { memoryPersist } from "./persist";
import type { Note, Phrase } from "@/lib/types";

const note = (id: string, kind: Note["kind"], text: string, entities: string[] = []): Note => ({ id, kind, text, entities, updatedAt: 0 });

const NOTES: Note[] = [
  note("cafe", "place", "Blue Door Café is my local coffee shop.", ["Blue Door Café"]),
  note("sam", "person", "Sam is the barista at Blue Door Café.", ["Sam", "Blue Door Café"]),
  note("usual", "preference", "My usual order at Blue Door Café is a large oat milk latte.", ["Blue Door Café"]),
  note("physio", "routine", "I have physio on Tuesdays at 10:30.", []),
  note("dog", "person", "Biscuit is my dog, a golden retriever.", ["Biscuit"]),
];

const phrase = (id: string, text: string, timesUsed: number, lastUsed: number): Phrase => ({
  id,
  text,
  context: { timeOfDay: "morning" },
  timesUsed,
  lastUsed,
});

/** Deterministic fake: a 384-dim vector with a 1 at a slot derived from keywords. */
const fakeEmbedder: Embedder = {
  async embed(texts) {
    return texts.map((t) => {
      const v = new Array(384).fill(0);
      v[/dog|biscuit|walk/i.test(t) ? 1 : 0] = 1;
      return v;
    });
  },
};

const ctx = { now: new Date(2026, 8, 29, 8) };

describe("MemoryStore", () => {
  it("stores notes and finds them by text", async () => {
    const m = await MemoryStore.create();
    await m.replaceAll(NOTES, []);
    const hits = await m.searchNotes("physio", ctx);
    expect(hits[0]?.id).toBe("physio");
  });

  it("always includes the current place and partner first, then related notes", async () => {
    const m = await MemoryStore.create();
    await m.replaceAll(NOTES, []);
    const hits = await m.searchNotes("what size would you like", { ...ctx, placeId: "cafe", partnerId: "sam" });
    const ids = hits.map((n) => n.id);
    expect(ids.slice(0, 2).sort()).toEqual(["cafe", "sam"]);
    expect(ids).toContain("usual");
    expect(ids).not.toContain("dog");
  });

  it("uses vectors for meaning when an embedder is available", async () => {
    const m = await MemoryStore.create({ embedder: fakeEmbedder });
    await m.replaceAll(NOTES, []);
    await m.whenVectorsReady();
    const hits = await m.searchNotes("going for a walk", ctx);
    expect(hits.map((n) => n.id)).toContain("dog");
  });

  it("falls back to text search when the embedder fails", async () => {
    const broken: Embedder = { embed: async () => Promise.reject(new Error("no model")) };
    const m = await MemoryStore.create({ embedder: broken });
    await m.replaceAll(NOTES, []);
    await m.whenVectorsReady();
    expect((await m.searchNotes("physio", ctx))[0]?.id).toBe("physio");
  });

  it("returns at most k notes", async () => {
    const m = await MemoryStore.create();
    await m.replaceAll(NOTES, []);
    expect((await m.searchNotes("blue door", { ...ctx, placeId: "cafe" }, 2)).length).toBe(2);
  });

  it("matches phrases by word prefixes, most used first", async () => {
    const m = await MemoryStore.create();
    await m.replaceAll([], [phrase("a", "My usual, please.", 1, 10), phrase("b", "My usual latte please", 5, 5), phrase("c", "See you soon", 9, 9)]);
    expect(m.matchPhrases("my us").map((p) => p.id)).toEqual(["b", "a"]);
    expect(m.matchPhrases("")).toEqual([]);
  });

  it("adds phrases and counts repeats", async () => {
    let t = 1000;
    const m = await MemoryStore.create({ now: () => t });
    const p1 = await m.addPhrase("Large, please.", { ...ctx, placeId: "cafe" });
    t = 2000;
    const p2 = await m.addPhrase("large please", ctx);
    expect(p2.id).toBe(p1.id);
    expect(p2.timesUsed).toBe(2);
    expect(p2.lastUsed).toBe(2000);
    expect(m.phrases()).toHaveLength(1);
  });

  it("picks style examples by overlap and recency", async () => {
    const m = await MemoryStore.create({ now: () => 100 * 86_400_000 });
    await m.replaceAll([], [
      phrase("old", "A large latte would be lovely", 1, 0),
      phrase("new", "Coffee sounds great", 1, 100 * 86_400_000),
      phrase("other", "See you at physio", 1, 100 * 86_400_000),
    ]);
    const ex = m.styleExamples("large latte", 2);
    expect(ex[0]).toBe("A large latte would be lovely");
    expect(ex).toHaveLength(2);
  });

  it("persists and reloads", async () => {
    const persist = memoryPersist();
    const a = await MemoryStore.create({ persist });
    await a.replaceAll(NOTES, [phrase("p", "Hello", 1, 1)]);
    await a.removeNote("dog");
    const b = await MemoryStore.create({ persist });
    expect(b.notes().map((n) => n.id).sort()).toEqual(["cafe", "physio", "sam", "usual"]);
    expect(b.phrases()).toHaveLength(1);
    expect(await b.searchNotes("physio", ctx)).toHaveLength(1);
  });

  it("updates a note in place", async () => {
    const m = await MemoryStore.create();
    await m.replaceAll(NOTES, []);
    await m.upsertNote(note("physio", "routine", "I have physio on Thursdays at 2.", []));
    expect(m.getNote("physio")?.text).toContain("Thursdays");
    expect((await m.searchNotes("thursdays", ctx))[0]?.id).toBe("physio");
  });

  it("always sends pinned notes right after the place and partner", async () => {
    const m = await MemoryStore.create();
    const me = note("me", "about-me", "I'm Tom. I'm Deaf and I read captions.");
    await m.replaceAll([...NOTES, { ...me, pinned: true }], []);
    const ids = (await m.searchNotes("what size would you like", { ...ctx, placeId: "cafe", partnerId: "sam" })).map((n) => n.id);
    expect(ids.slice(0, 3)).toEqual(["cafe", "sam", "me"]);
    const noQuery = (await m.searchNotes("", ctx)).map((n) => n.id);
    expect(noQuery).toEqual(["me"]);
  });

  it("does not repeat a pinned note that is also the place or partner, and keeps to k", async () => {
    const m = await MemoryStore.create();
    await m.replaceAll(NOTES.map((n) => (n.id === "sam" ? { ...n, pinned: true } : n)), []);
    const ids = (await m.searchNotes("barista", { ...ctx, placeId: "cafe", partnerId: "sam" }, 2)).map((n) => n.id);
    expect(ids).toEqual(["cafe", "sam"]);
  });

  it("works with no pinned note", async () => {
    const m = await MemoryStore.create();
    await m.replaceAll(NOTES, []);
    expect((await m.searchNotes("", ctx)).map((n) => n.id)).toEqual([]);
  });
});
