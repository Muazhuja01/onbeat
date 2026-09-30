import { describe, expect, it, vi } from "vitest";
import { memoryKeyValue, type KeyValue } from "@/lib/profiles/kv";
import type { Note } from "@/lib/types";
import { PENDING_MAX, PendingStore } from "./pending";
import type { PendingSuggestion } from "./types";

const sug = (id: string, text: string, extra: Partial<PendingSuggestion> = {}): PendingSuggestion => ({
  id,
  action: "add",
  draft: { kind: "routine", text },
  sources: [{ speaker: "partner", text: "source line", at: 1 }],
  createdAt: 1,
  ...extra,
});
const notes: Note[] = [{ id: "physio", kind: "routine", text: "I have physio on Tuesdays at 10:30.", entities: [], updatedAt: 1 }];
const ids = (s: PendingStore) => s.list().map((p) => p.id);

describe("PendingStore", () => {
  it("adds newest first, keeping a batch in its own order, and keeps them across a reload", async () => {
    const kv = memoryKeyValue();
    const store = await PendingStore.open(kv, "p1");
    expect(await store.merge([sug("a1", "I like green tea."), sug("a2", "My sister Hana visits on Sundays.")], notes)).toBe(2);
    await store.merge([sug("b", "My dentist is Dr Osei.")], notes);
    expect(ids(store)).toEqual(["b", "a1", "a2"]);
    expect(ids(await PendingStore.open(kv, "p1"))).toEqual(["b", "a1", "a2"]);
  });

  it("drops a new note that repeats an existing note, and an edit that is already applied", async () => {
    const store = await PendingStore.open(memoryKeyValue(), "p1");
    const repeat = sug("r", "I have physio on Tuesdays at 10:30");
    const applied = sug("e", "I have physio on Tuesdays at 10:30.", { action: "edit", noteId: "physio" });
    expect(await store.merge([repeat, applied], notes)).toBe(0);
    expect(ids(store)).toEqual([]);
  });

  it("replaces a waiting edit of the same note, and a near copy of a waiting suggestion", async () => {
    const store = await PendingStore.open(memoryKeyValue(), "p1");
    await store.merge([sug("e1", "I have physio on Wednesdays at 10:30.", { action: "edit", noteId: "physio" }), sug("t1", "I like green tea.")], notes);
    await store.merge([sug("e2", "I have physio on Thursdays at 10:30.", { action: "edit", noteId: "physio" }), sug("t2", "I like green tea!")], notes);
    expect(ids(store)).toEqual(["e2", "t2"]);
  });

  it(`keeps at most ${PENDING_MAX}`, async () => {
    const store = await PendingStore.open(memoryKeyValue(), "p1");
    for (let i = 0; i < PENDING_MAX + 3; i++) await store.merge([sug(`s${i}`, `Fact number ${i} about zebra${i}.`)], notes);
    expect(store.list()).toHaveLength(PENDING_MAX);
    expect(store.list()[0].id).toBe(`s${PENDING_MAX + 2}`);
  });

  it("remembers what was skipped, so it isn't suggested again", async () => {
    const kv = memoryKeyValue();
    const store = await PendingStore.open(kv, "p1");
    await store.merge([sug("a", "I like green tea."), sug("b", "My sister Hana visits on Sundays.")], notes);
    await store.skip("a");
    expect(ids(store)).toEqual(["b"]);
    const again = await PendingStore.open(kv, "p1");
    expect(await again.merge([sug("a2", "I like green tea!")], notes)).toBe(0);
    await again.skipAll();
    expect(ids(again)).toEqual([]);
    expect(await again.merge([sug("b2", "My sister Hana visits on Sundays.")], notes)).toBe(0);
  });

  it("removes a kept suggestion without remembering it as skipped", async () => {
    const store = await PendingStore.open(memoryKeyValue(), "p1");
    await store.merge([sug("a", "I like green tea.")], notes);
    await store.remove("a");
    expect(await store.merge([sug("a2", "I like green tea.")], notes)).toBe(1);
  });

  it("tells listeners about every change", async () => {
    const store = await PendingStore.open(memoryKeyValue(), "p1");
    const cb = vi.fn();
    const off = store.onChange(cb);
    await store.merge([sug("a", "I like green tea.")], notes);
    await store.skip("a");
    await store.replaceAll([sug("b", "x")]);
    expect(cb).toHaveBeenCalledTimes(3);
    off();
    await store.remove("b");
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("keeps working when storage fails", async () => {
    const broken: KeyValue = {
      get: async () => {
        throw new Error("blocked");
      },
      set: async () => {
        throw new Error("full");
      },
      del: async () => {},
    };
    const store = await PendingStore.open(broken, "p1");
    await store.merge([sug("a", "I like green tea.")], notes);
    expect(ids(store)).toEqual(["a"]);
  });
});
