import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { idbKeyValue, memoryKeyValue } from "./kv";
import { pendingKey, queueKey, skippedKey } from "@/lib/learning/keys";
import { DEFAULT_VOICE } from "@/lib/voice/choices";
import { cleanName, openBrowserRegistry, ProfileRegistry, profileVoice } from "./registry";

describe("ProfileRegistry", () => {
  it("starts empty and creates an active profile", async () => {
    const reg = await ProfileRegistry.open(memoryKeyValue(), { now: () => 5 });
    expect(reg.list()).toEqual([]);
    expect(reg.active()).toBeNull();
    const p = await reg.create("  Maya   Lopez ");
    expect(p).toMatchObject({ name: "Maya Lopez", createdAt: 5 });
    expect(reg.active()?.id).toBe(p.id);
  });

  it("refuses a blank name and cuts long ones", async () => {
    const reg = await ProfileRegistry.open(memoryKeyValue());
    await expect(reg.create("   ")).rejects.toThrow();
    expect(cleanName("x".repeat(60))).toHaveLength(40);
  });

  it("keeps each profile's notes apart and survives reopening", async () => {
    const kv = memoryKeyValue();
    const reg = await ProfileRegistry.open(kv);
    const a = await reg.create("A");
    const b = await reg.create("B");
    await reg
      .persistFor(a.id)
      .save({ version: 1, notes: [], phrases: [{ id: "p", text: "Hi", context: { timeOfDay: "morning" }, timesUsed: 1, lastUsed: 1 }] });
    expect(await reg.persistFor(b.id).load()).toBeNull();
    const again = await ProfileRegistry.open(kv);
    expect(again.list().map((p) => p.name)).toEqual(["A", "B"]);
    expect(again.active()?.id).toBe(b.id);
    expect((await again.persistFor(a.id).load())?.phrases[0]?.text).toBe("Hi");
  });

  it("switches, renames and removes", async () => {
    const kv = memoryKeyValue();
    const reg = await ProfileRegistry.open(kv);
    const a = await reg.create("A");
    const b = await reg.create("B");
    await reg.setActive(a.id);
    await reg.rename(a.id, "Anna");
    expect(reg.active()?.name).toBe("Anna");
    await reg.persistFor(a.id).save({ version: 1, notes: [], phrases: [] });
    await reg.remove(a.id);
    expect(reg.list().map((p) => p.id)).toEqual([b.id]);
    expect(reg.active()?.id).toBe(b.id);
    expect(await kv.get(`profile:${a.id}`)).toBeUndefined();
    await reg.remove(b.id);
    expect(reg.active()).toBeNull();
  });

  it("gives a clashing name a number", async () => {
    const reg = await ProfileRegistry.open(memoryKeyValue());
    await reg.create("Maya");
    expect(reg.uniqueName("Maya")).toBe("Maya (2)");
    await reg.create("Maya (2)");
    expect(reg.uniqueName("maya")).toBe("maya (3)");
    expect(reg.uniqueName("Tom")).toBe("Tom");
  });

  it("drops the old single snapshot", async () => {
    const kv = memoryKeyValue();
    await kv.set("snapshot", { version: 1, notes: [], phrases: [] });
    const reg = await ProfileRegistry.open(kv);
    expect(reg.list()).toEqual([]);
    expect(await kv.get("snapshot")).toBeUndefined();
  });

  it("works on IndexedDB and reports durable storage", async () => {
    const reg = await openBrowserRegistry();
    expect(reg.durable).toBe(true);
    await reg.create("Idb");
    const again = await ProfileRegistry.open(idbKeyValue());
    expect(again.list().some((p) => p.name === "Idb")).toBe(true);
  });
});

describe("ProfileRegistry learning data", () => {
  it("deleting a profile deletes its learning data too", async () => {
    const kv = memoryKeyValue();
    const reg = await ProfileRegistry.open(kv);
    const p = await reg.create("Priya");
    for (const key of [queueKey(p.id), pendingKey(p.id), skippedKey(p.id)]) await kv.set(key, ["x"]);
    expect(reg.keyValue).toBe(kv);
    await reg.remove(p.id);
    for (const key of [queueKey(p.id), pendingKey(p.id), skippedKey(p.id)]) expect(await kv.get(key)).toBeUndefined();
  });
});

describe("ProfileRegistry learning data in flight", () => {
  it("a queue or suggestion list opened before a profile was deleted never writes it back", async () => {
    const { LearningQueue } = await import("@/lib/learning/queue");
    const { PendingStore } = await import("@/lib/learning/pending");
    const kv = memoryKeyValue();
    const reg = await ProfileRegistry.open(kv);
    const p = await reg.create("Priya");
    const queue = await LearningQueue.open(kv, p.id);
    const pending = await PendingStore.open(kv, p.id);
    await reg.remove(p.id);
    await queue.add({ id: "l1", speaker: "partner", text: "hi", at: Date.now() });
    await pending.merge([{ id: "s1", action: "add", draft: { kind: "routine", text: "I swim on Fridays." }, sources: [], createdAt: 1 }], []);
    for (const key of [queueKey(p.id), pendingKey(p.id)]) expect(await kv.get(key)).toBeUndefined();
  });
});

describe("voice", () => {
  it("keeps a profile's voice, and uses the default when none is stored", async () => {
    const kv = memoryKeyValue();
    const r = await ProfileRegistry.open(kv);
    const tom = await r.create("Tom", { gender: "male", accent: "american", style: "calm", speed: "normal" });
    const maya = await r.create("Maya");
    expect(profileVoice(r.list().find((p) => p.id === tom.id))).toEqual({ gender: "male", accent: "american", style: "calm", speed: "normal" });
    expect(profileVoice(r.list().find((p) => p.id === maya.id))).toEqual(DEFAULT_VOICE);
    await r.setVoice(maya.id, { gender: "female", accent: "british", style: "clear", speed: "faster" });
    const reopened = await ProfileRegistry.open(kv);
    expect(profileVoice(reopened.list().find((p) => p.id === maya.id))?.style).toBe("clear");
  });

  it("treats a stored value that isn't a valid choice as the default", () => {
    expect(profileVoice({ id: "x", name: "X", createdAt: 0, voice: { gender: "male", accent: "british", style: "deep", speed: "normal" } })).toEqual(DEFAULT_VOICE);
  });
});
