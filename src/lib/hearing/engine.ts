import type { WorkerLike } from "@/lib/worker-like";
import type { HearingWorkerMessage } from "./messages";
import { MicError, type MicSource } from "./mic";

export type HearingStatus = "off" | "loading" | "listening" | "denied" | "unavailable" | "error";

export interface TurnEnd {
  text: string;
  /** When the partner's last word ended (ms since epoch). */
  endedAt: number;
}

export type HearingEvents = {
  status: HearingStatus;
  progress: number;
  level: number;
  /** Timestamp of the moment speech started. */
  speechStart: number;
  /** Live caption so far; "" clears it. */
  partial: string;
  turnEnd: TurnEnd;
};

/** What the conversation screen needs from hearing, so tests can pass a fake. */
export interface Hearing {
  readonly status: HearingStatus;
  on<K extends keyof HearingEvents>(event: K, cb: (value: HearingEvents[K]) => void): () => void;
  start(): Promise<void>;
  stop(): void;
  pause(): void;
  resume(afterMs?: number): void;
}

export interface HearingDeps {
  createWorker: () => WorkerLike | null;
  openMic: (onChunk: (samples: Float32Array, level: number) => void) => Promise<MicSource>;
  model: string;
  levelEveryMs?: number;
  now?: () => number;
}

export class HearingEngine implements Hearing {
  status: HearingStatus = "off";
  private listeners: { [K in keyof HearingEvents]: Set<(v: HearingEvents[K]) => void> } = {
    status: new Set(),
    progress: new Set(),
    level: new Set(),
    speechStart: new Set(),
    partial: new Set(),
    turnEnd: new Set(),
  };
  private worker: WorkerLike | null = null;
  private mic: MicSource | null = null;
  private ready = false;
  private loading = false;
  private paused = false;
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  private startToken = 0;
  private lastLevelAt = -Infinity;
  private hasPartial = false;

  constructor(private readonly deps: HearingDeps) {}

  on<K extends keyof HearingEvents>(event: K, cb: (v: HearingEvents[K]) => void): () => void {
    this.listeners[event].add(cb);
    return () => {
      this.listeners[event].delete(cb);
    };
  }

  async start(): Promise<void> {
    if (this.status === "loading" || this.status === "listening") return;
    const token = ++this.startToken;
    this.setStatus("loading");
    if (!this.worker) {
      this.worker = this.deps.createWorker();
      if (!this.worker) {
        this.setStatus("unavailable");
        return;
      }
      this.worker.onmessage = (e: MessageEvent) => this.onWorkerMessage(e.data as HearingWorkerMessage);
    }
    if (!this.ready && !this.loading) {
      this.loading = true;
      this.worker.postMessage({ type: "load", model: this.deps.model });
    }
    let mic: MicSource;
    try {
      mic = await this.deps.openMic((samples, level) => this.onChunk(samples, level));
    } catch (err) {
      if (token === this.startToken) this.setStatus(err instanceof MicError && err.kind === "denied" ? "denied" : "unavailable");
      return;
    }
    // Stopped, or the model failed, while the browser was asking for permission.
    if (token !== this.startToken || (this.status as HearingStatus) !== "loading") {
      mic.stop();
      return;
    }
    this.mic = mic;
    if (this.ready) this.setStatus("listening");
  }

  stop(): void {
    this.startToken++;
    clearTimeout(this.resumeTimer);
    this.paused = false;
    this.mic?.stop();
    this.mic = null;
    this.worker?.postMessage({ type: "reset" });
    this.clearPartial();
    this.emit("level", 0);
    this.setStatus("off");
  }

  /** Stop hearing for now (the app is speaking), dropping anything half-heard. */
  pause(): void {
    clearTimeout(this.resumeTimer);
    if (this.paused) return;
    this.paused = true;
    this.worker?.postMessage({ type: "reset" });
    this.clearPartial();
  }

  /** Hear again after `afterMs`, so the tail of the app's own voice isn't captioned. */
  resume(afterMs = 0): void {
    clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.paused = false;
    }, afterMs);
  }

  private get active(): boolean {
    return this.status === "listening" && !this.paused;
  }

  private onChunk(samples: Float32Array, level: number): void {
    const now = this.deps.now?.() ?? Date.now();
    if (now - this.lastLevelAt >= (this.deps.levelEveryMs ?? 100)) {
      this.lastLevelAt = now;
      this.emit("level", this.paused ? 0 : level);
    }
    if (!this.active || !this.worker) return;
    this.worker.postMessage({ type: "audio", samples }, [samples.buffer as ArrayBuffer]);
  }

  private onWorkerMessage(msg: HearingWorkerMessage): void {
    switch (msg.type) {
      case "progress":
        this.emit("progress", msg.value);
        return;
      case "ready":
        this.ready = true;
        this.loading = false;
        if (this.mic && this.status === "loading") this.setStatus("listening");
        return;
      case "error":
        this.ready = false;
        this.loading = false;
        if (this.status === "loading") {
          this.mic?.stop();
          this.mic = null;
          this.setStatus("error");
        }
        return;
      case "speechStart":
        if (this.active) this.emit("speechStart", this.deps.now?.() ?? Date.now());
        return;
      case "partial":
        if (!this.active) return;
        this.hasPartial = true;
        this.emit("partial", msg.text);
        return;
      case "turnEnd": {
        if (!this.active) return;
        const had = this.hasPartial;
        this.hasPartial = false;
        if (msg.text) this.emit("turnEnd", { text: msg.text, endedAt: msg.endedAt });
        else if (had) this.emit("partial", "");
        return;
      }
    }
  }

  private clearPartial(): void {
    if (!this.hasPartial) return;
    this.hasPartial = false;
    this.emit("partial", "");
  }

  private setStatus(status: HearingStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit("status", status);
  }

  private emit<K extends keyof HearingEvents>(event: K, value: HearingEvents[K]): void {
    for (const cb of this.listeners[event]) cb(value);
  }
}
