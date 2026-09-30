import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { idbKeyValue, memoryKeyValue } from "./kv";
import { cleanName, openBrowserRegistry, ProfileRegistry } from "./registry";

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
