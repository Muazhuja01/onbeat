import type { WorkerLike } from "@/lib/worker-like";
import type { Embedder } from "./store";

type Pending = { resolve: (v: number[][]) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export class WorkerEmbedder implements Embedder {
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(
    private readonly worker: WorkerLike,
    private readonly timeoutMs = 60_000,
  ) {
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as { id: number; vectors?: number[][]; error?: string };
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      clearTimeout(p.timer);
      if (data.error !== undefined) p.reject(new Error(data.error));
      else p.resolve(data.vectors ?? []);
    };
  }

  embed(texts: string[]): Promise<number[][]> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error("Embedding timed out"));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, texts });
    });
  }
}

export function createBrowserEmbedder(): WorkerEmbedder | null {
  if (typeof Worker === "undefined") return null;
  const worker = new Worker(new URL("../../workers/embedder.worker.ts", import.meta.url), { type: "module" });
  return new WorkerEmbedder(worker);
}
