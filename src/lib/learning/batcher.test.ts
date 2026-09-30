import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryKeyValue } from "@/lib/profiles/kv";
import { Batcher, BATCH_LINES, QUIET_MS, type SendResult } from "./batcher";
import { LearningQueue } from "./queue";
import type { QueuedLine } from "./types";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup(result: SendResult = "sent") {
  const queue = await LearningQueue.open(memoryKeyValue(), "p1");
  const send = vi.fn<(lines: QueuedLine[]) => Promise<SendResult>>(async () => result);
  const batcher = new Batcher(queue, send);
  let n = 0;
  const add = async (count = 1) => {
    for (let i = 0; i < count; i++) {
      await queue.add({ id: `l${n++}`, speaker: "partner", text: "hello", at: Date.now() });
      batcher.lineAdded();
    }
  };
  return { queue, send, batcher, add };
}

describe("Batcher", () => {
  it("sends after a minute with no new line", async () => {
    const { queue, send, add } = await setup();
    await add(2);
    await vi.advanceTimersByTimeAsync(QUIET_MS - 1);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].map((l) => l.id)).toEqual(["l0", "l1"]);
    expect(queue.take()).toEqual([]);
  });

  it("doesn't send a single line", async () => {
    const { send, add } = await setup();
    await add(1);
    await vi.advanceTimersByTimeAsync(QUIET_MS * 2);
    expect(send).not.toHaveBeenCalled();
  });

  it("starts the wait again with each new line", async () => {
    const { send, add } = await setup();
    await add(2);
    await vi.advanceTimersByTimeAsync(QUIET_MS - 1_000);
    await add(1);
    await vi.advanceTimersByTimeAsync(QUIET_MS - 1_000);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send.mock.calls[0][0]).toHaveLength(3);
  });

  it(`sends at once when ${BATCH_LINES} lines build up`, async () => {
    const { send, add } = await setup();
    await add(BATCH_LINES);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toHaveLength(BATCH_LINES);
  });

  it("sends when the page is hidden", async () => {
    const { send, batcher, add } = await setup();
    await add(2);
    batcher.pageHidden();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps the lines when a batch fails, and tries again after the next quiet minute", async () => {
    const { queue, send, batcher, add } = await setup("failed");
    await add(2);
    batcher.pageHidden();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.take()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("counts a thrown error as a failed batch", async () => {
    const { queue, send, batcher, add } = await setup();
    send.mockRejectedValueOnce(new Error("offline"));
    await add(2);
    batcher.pageHidden();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.take()).toHaveLength(2);
  });

  it("sends one batch at a time, then waits a quiet minute for lines that came in meanwhile", async () => {
    const { send, batcher, add } = await setup();
    let release!: (r: SendResult) => void;
    send.mockImplementationOnce(() => new Promise<SendResult>((r) => (release = r)));
    await add(2);
    batcher.pageHidden();
    batcher.pageHidden();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    await add(2);
    release("sent");
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].map((l) => l.id)).toEqual(["l2", "l3"]);
  });

  it("stops when disposed", async () => {
    const { send, batcher, add } = await setup();
    await add(2);
    batcher.dispose();
    batcher.pageHidden();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(send).not.toHaveBeenCalled();
  });
});
