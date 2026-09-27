import { describe, expect, it, vi } from "vitest";
import { WorkerEmbedder } from "./worker-embedder";
import type { WorkerLike } from "@/lib/worker-like";

class FakeWorker implements WorkerLike {
  sent: { id: number; texts: string[] }[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage(m: unknown) {
    this.sent.push(m as { id: number; texts: string[] });
  }
  terminate() {}
  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

describe("WorkerEmbedder", () => {
  it("matches responses to requests by id", async () => {
    const w = new FakeWorker();
    const e = new WorkerEmbedder(w);
    const a = e.embed(["a"]);
    const b = e.embed(["b"]);
    w.reply({ id: w.sent[1].id, vectors: [[2]] });
    w.reply({ id: w.sent[0].id, vectors: [[1]] });
    expect(await a).toEqual([[1]]);
    expect(await b).toEqual([[2]]);
  });

  it("rejects on worker error", async () => {
    const w = new FakeWorker();
    const e = new WorkerEmbedder(w);
    const p = e.embed(["x"]);
    w.reply({ id: w.sent[0].id, error: "model failed" });
    await expect(p).rejects.toThrow("model failed");
  });

  it("times out", async () => {
    vi.useFakeTimers();
    const w = new FakeWorker();
    const e = new WorkerEmbedder(w, 1000);
    const p = e.embed(["x"]);
    vi.advanceTimersByTime(1001);
    await expect(p).rejects.toThrow("timed out");
    vi.useRealTimers();
  });
});
