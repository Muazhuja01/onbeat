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

describe("quick phrases", () => {
  const person = { id: "sam", kind: "person" as const, text: "Sam is the barista.", entities: ["Sam"], updatedAt: 0 };
  const place = { id: "cafe", kind: "place" as const, text: "Blue Door Café.", entities: ["Blue Door Café"], updatedAt: 0 };

  async function store() {
    let t = 1_000;
    const s = await MemoryStore.create({ now: () => (t += 1000) });
    await s.replaceAll([person, place], []);
    return s;
  }

  it("shows phrases for the person first, then the place, else general ones", async () => {
    const s = await store();
    await s.addQuickPhrase("My usual, please.", { partnerId: "sam" });
    await s.addQuickPhrase("Can I sit by the window?", { placeId: "cafe" });
    await s.addQuickPhrase("I type to talk.", {});
    expect(s.quickPhrases({ partnerId: "sam", placeId: "cafe" }).map((p) => p.text)).toEqual(["My usual, please.", "Can I sit by the window?"]);
    expect(s.quickPhrases({}).map((p) => p.text)).toEqual(["I type to talk."]);
    expect(s.quickPhrases({ partnerId: "someone-else" }).map((p) => p.text)).toEqual(["I type to talk."]);
  });

  it("never shows everyday phrases and caps the row at 4", async () => {
    const s = await store();
    await s.addPhrase("Morning!", { now: new Date() });
    for (const t of ["One.", "Two.", "Three.", "Four.", "Five."]) await s.addQuickPhrase(t, {});
    const row = s.quickPhrases({});
    expect(row).toHaveLength(4);
    expect(row.map((p) => p.text)).not.toContain("Morning!");
  });

  it("orders by use, then newest", async () => {
    const s = await store();
    await s.addQuickPhrase("Old.", {});
    await s.addQuickPhrase("New.", {});
    expect(s.quickPhrases({}).map((p) => p.text)).toEqual(["New.", "Old."]);
    await s.addPhrase("Old.", { now: new Date() });
    expect(s.quickPhrases({}).map((p) => p.text)).toEqual(["Old.", "New."]);
  });

  it("keeps a quick phrase tied to its person when it is spoken elsewhere", async () => {
    const s = await store();
    await s.addQuickPhrase("My usual, please.", { partnerId: "sam" });
    await s.addPhrase("My usual, please.", { now: new Date(), partnerId: undefined, placeId: undefined });
    const [p] = s.allQuickPhrases();
    expect(p.context.partnerId).toBe("sam");
    expect(p.timesUsed).toBe(1);
  });

  it("refuses a duplicate, and turns an everyday phrase with the same words into a quick one", async () => {
    const s = await store();
    expect(await s.addQuickPhrase("My usual, please.", {})).not.toBeNull();
    expect(await s.addQuickPhrase("my usual please", {})).toBeNull();
    await s.addPhrase("See you tomorrow.", { now: new Date() });
    const made = await s.addQuickPhrase("See you tomorrow.", { partnerId: "sam" });
    expect(made?.quick).toBe(true);
    expect(s.phrases().filter((p) => p.text === "See you tomorrow.")).toHaveLength(1);
  });

  it("unties phrases from a deleted note", async () => {
    const s = await store();
    await s.addQuickPhrase("My usual, please.", { partnerId: "sam" });
    await s.removeNote("sam");
    expect(s.quickPhrases({}).map((p) => p.text)).toEqual(["My usual, please."]);
    expect(s.allQuickPhrases()[0].context.partnerId).toBeUndefined();
  });

  it("edits and removes a quick phrase", async () => {
    const s = await store();
    const a = (await s.addQuickPhrase("One.", {}))!;
    await s.addQuickPhrase("Two.", {});
    expect(await s.updateQuickPhrase(a.id, "Two.", {})).toBe(false);
    expect(await s.updateQuickPhrase(a.id, "Uno.", { placeId: "cafe" })).toBe(true);
    expect(s.allQuickPhrases().find((p) => p.id === a.id)?.context.placeId).toBe("cafe");
    await s.removePhrase(a.id);
    expect(s.allQuickPhrases().map((p) => p.text)).toEqual(["Two."]);
  });
});
