import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { detectPersist, idbPersist } from "./idb-persist";

describe("idbPersist", () => {
  it("saves and loads a snapshot", async () => {
    const p = idbPersist();
    expect(p.durable).toBe(true);
    await p.save({ version: 1, notes: [], phrases: [{ id: "a", text: "Hi", context: { timeOfDay: "morning" }, timesUsed: 1, lastUsed: 1 }] });
    const again = idbPersist();
    expect((await again.load())?.phrases[0]?.text).toBe("Hi");
  });

  it("detectPersist returns a durable store when IndexedDB works", async () => {
    expect((await detectPersist()).durable).toBe(true);
  });
});
