import type { WorkerLike } from "@/lib/worker-like";
import type { HearingWorkerMessage } from "./messages";
import { MicError, type MicSource } from "./mic";

/** "interrupted": the microphone stopped on its own (unplugged, permission revoked, a phone call). */
export type HearingStatus = "off" | "loading" | "listening" | "denied" | "unavailable" | "error" | "interrupted";

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
  /** onEnded: the microphone stopped without being asked to. */
  openMic: (onChunk: (samples: Float32Array, level: number) => void, onEnded: () => void) => Promise<MicSource>;
  model: string;
  levelEveryMs?: number;
  now?: () => number;
  /**
   * A second, more accurate transcription of a finished turn (cloud captions).
   * Resolves to null to keep the in-browser text: when it's off, fails or is slow.
   */
  refineTurn?: (audio: Float32Array) => Promise<string | null>;
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
  /** Worker messages that arrived while a turn was being refined, kept in order. */
  private backlog: HearingWorkerMessage[] = [];
  private refining = false;
  /** Bumped when hearing stops, so a late refined turn is dropped. */
  private epoch = 0;

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
      let worker: WorkerLike | null;
      try {
        worker = this.deps.createWorker();
      } catch (err) {
        console.error("HearingEngine: couldn't create the speech recognition worker", err);
        worker = null;
      }
      if (!worker) {
        this.setStatus("unavailable");
        return;
      }
      this.worker = worker;
      worker.onmessage = (e: MessageEvent) => this.onWorkerMessage(e.data as HearingWorkerMessage);
      worker.onerror = (e: ErrorEvent) => this.onWorkerDied(worker, e);
    }
    if (!this.ready && !this.loading) {
      this.loading = true;
      this.worker.postMessage({ type: "load", model: this.deps.model });
    }
    let mic: MicSource;
    try {
      mic = await this.deps.openMic(
        (samples, level) => this.onChunk(samples, level),
        () => {
          if (token === this.startToken) this.onMicEnded();
        },
      );
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
    this.dropPending();
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

  /** The worker failed to load, threw, or was killed (for example for memory). */
  private onWorkerDied(worker: WorkerLike, e: ErrorEvent): void {
    if (worker !== this.worker) return;
    console.error("HearingEngine: speech recognition worker stopped", e.message);
    worker.terminate();
    this.worker = null;
    this.ready = false;
    this.loading = false;
    this.halt("error");
  }

  /** The microphone stopped without being asked to. */
  private onMicEnded(): void {
    this.worker?.postMessage({ type: "reset" });
    this.halt("interrupted");
  }

  /** Stops hearing because something broke, and says so. */
  private halt(status: HearingStatus): void {
    this.startToken++;
    this.dropPending();
    clearTimeout(this.resumeTimer);
    this.paused = false;
    this.mic?.stop();
    this.mic = null;
    this.clearPartial();
    this.emit("level", 0);
    this.setStatus(status);
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
    // Captions must stay in order: the next turn waits for the one being refined.
    if (this.refining && (msg.type === "speechStart" || msg.type === "partial" || msg.type === "turnEnd")) {
      this.backlog.push(msg);
      return;
    }
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
      case "turnEnd":
        if (!this.active) return;
        if (this.deps.refineTurn && msg.audio?.length) void this.refine(msg, msg.audio);
        else this.endTurn(msg.text, msg.endedAt);
        return;
    }
  }

  /** Refines one turn, then handles what arrived meanwhile, in order. */
  private async refine(msg: Extract<HearingWorkerMessage, { type: "turnEnd" }>, audio: Float32Array): Promise<void> {
    this.refining = true;
    const epoch = this.epoch;
    let better: string | null = null;
    try {
      better = await this.deps.refineTurn!(audio);
    } catch {
      better = null;
    }
    this.refining = false;
    if (epoch !== this.epoch) return;
    // The partner finished this line before any pause for the app's own voice, so it is kept.
    this.endTurn(better?.trim() || msg.text, msg.endedAt, true);
    while (this.backlog.length && !this.refining) this.onWorkerMessage(this.backlog.shift()!);
  }

  private endTurn(text: string, endedAt: number, evenIfPaused = false): void {
    if (evenIfPaused ? this.status !== "listening" : !this.active) return;
    const had = this.hasPartial;
    this.hasPartial = false;
    if (text) this.emit("turnEnd", { text, endedAt });
    else if (had) this.emit("partial", "");
  }

  /** Forgets a turn being refined and anything queued behind it. */
  private dropPending(): void {
    this.epoch++;
    this.refining = false;
    this.backlog = [];
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
