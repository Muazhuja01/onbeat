import { describe, expect, it } from "vitest";
import { memoryKeyValue, type KeyValue } from "@/lib/profiles/kv";
import { queueKey } from "./keys";
import { BACKOFF_MS, clearQueues, LearningQueue, LINE_MAX_AGE_MS, QUEUE_MAX } from "./queue";
import type { QueuedLine } from "./types";

const line = (id: string, at = 1_000): QueuedLine => ({ id, speaker: "partner", text: `line ${id}`, at });
const ids = (q: LearningQueue) => q.take().map((l) => l.id);

describe("LearningQueue", () => {
  it("keeps lines across a reload", async () => {
    const kv = memoryKeyValue();
    const q = await LearningQueue.open(kv, "p1", () => 2_000);
    await q.add(line("a"));
    expect(ids(await LearningQueue.open(kv, "p1", () => 2_000))).toEqual(["a"]);
    expect(ids(await LearningQueue.open(kv, "p2", () => 2_000))).toEqual([]);
  });

  it(`holds at most ${QUEUE_MAX} lines, dropping the oldest`, async () => {
    const q = await LearningQueue.open(memoryKeyValue(), "p1", () => 2_000);
    for (let i = 0; i < QUEUE_MAX + 5; i++) await q.add(line(`l${i}`));
    expect(q.take()).toHaveLength(QUEUE_MAX);
    expect(q.take()[0].id).toBe("l5");
  });

  it("drops lines older than a day", async () => {
    let now = 1_000;
    const q = await LearningQueue.open(memoryKeyValue(), "p1", () => now);
    await q.add(line("old", 1_000));
    now = 1_000 + LINE_MAX_AGE_MS + 1;
    await q.add(line("new", now));
    expect(ids(q)).toEqual(["new"]);
  });

  it("removes only the lines a batch sent", async () => {
    const q = await LearningQueue.open(memoryKeyValue(), "p1", () => 2_000);
    await q.add(line("a"));
    await q.add(line("b"));
    const sent = q.take();
    await q.add(line("c"));
    await q.ack(sent.slice(0, 1).map((l) => l.id));
    expect(ids(q)).toEqual(["b", "c"]);
  });

  it("waits 10 minutes after three failed batches in a row", async () => {
    let now = 0;
    const q = await LearningQueue.open(memoryKeyValue(), "p1", () => now);
    await q.add(line("a", 0));
    await q.fail();
    await q.fail();
    expect(ids(q)).toEqual(["a"]);
    await q.fail();
    expect(ids(q)).toEqual([]);
    now = BACKOFF_MS - 1;
    expect(ids(q)).toEqual([]);
    now = BACKOFF_MS;
    expect(ids(q)).toEqual(["a"]);
  });

  it("starts counting failures again after a batch goes through", async () => {
    const q = await LearningQueue.open(memoryKeyValue(), "p1", () => 2_000);
    await q.add(line("a"));
    await q.fail();
    await q.fail();
    await q.ack([]);
    await q.fail();
    expect(ids(q)).toEqual(["a"]);
  });

  it("clears one queue, or every profile's", async () => {
    const kv = memoryKeyValue();
    const q1 = await LearningQueue.open(kv, "p1", () => 2_000);
    await q1.add(line("a"));
    await q1.clear();
    expect(ids(q1)).toEqual([]);
    const q2 = await LearningQueue.open(kv, "p2", () => 2_000);
    await q2.add(line("b"));
    await clearQueues(kv, ["p1", "p2"]);
    expect(await kv.get(queueKey("p2"))).toBeUndefined();
  });

  it("keeps working when storage fails", async () => {
    const broken: KeyValue = {
      get: async () => {
        throw new Error("blocked");
      },
      set: async () => {
        throw new Error("full");
      },
      del: async () => {
        throw new Error("blocked");
      },
    };
    const q = await LearningQueue.open(broken, "p1", () => 2_000);
    await q.add(line("a"));
    expect(ids(q)).toEqual(["a"]);
    await expect(clearQueues(broken, ["p1"])).resolves.toBeUndefined();
  });
});
