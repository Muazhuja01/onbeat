import type { WorkerLike } from "@/lib/worker-like";
import { backupVoice } from "./choices";
import type { VoiceSource, VoiceWorkerMessage, VoiceWorkerRequest } from "./messages";
import { decodeWav } from "./wav";

/** An HTTP error from /api/speak. 4xx answers are about the request, not an outage. */
export class SpeakError extends Error {
  constructor(readonly status: number) {
    super(`speak failed with ${status}`);
  }
}

export const MAX_LINE = 300;

export interface RouterDeps {
  kokoro: WorkerLike | null;
  /** Resolves with a WAV clip; rejects with SpeakError(status) for an HTTP error, anything else for a network failure or abort. */
  speak: (req: { text: string; voice: string; speed: number }, signal: AbortSignal) => Promise<ArrayBuffer>;
  /** True when the voice server answered that it's ready. */
  warm: () => Promise<boolean>;
  lineWaitMs?: number;
  preparedWaitMs?: number;
  idleMs?: number;
  retryMs?: number;
}

type Generate = Extract<VoiceWorkerRequest, { type: "generate" }>;

/**
 * Sits where the Kokoro worker used to: lines go to Chatterbox through /api/speak, and to the
 * Kokoro worker (in each voice's Kokoro partner) when Chatterbox is waking, slow or down.
 */
export class VoiceRouter implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  /** null until the first wake call, so that call's "waking" reaches the engine. Treated like "waking". */
  private source: VoiceSource | null = null;
  private kokoroReady = false;
  private kokoroFailed: boolean;
  private readySent = false;
  private failures = 0;
  private lastLineAt = 0;
  private held: Generate[] = [];
  private kokoroJobs = new Set<number>();
  private waking: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: RouterDeps) {
    this.kokoroFailed = !deps.kokoro;
    if (deps.kokoro) deps.kokoro.onmessage = (e: MessageEvent) => this.fromKokoro(e.data as VoiceWorkerMessage);
  }

  postMessage(message: unknown): void {
    const msg = message as VoiceWorkerRequest;
    if (msg.type === "load") {
      this.deps.kokoro?.postMessage({ type: "load" });
      void this.wake();
      return;
    }
    this.route(msg);
  }

  terminate(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.deps.kokoro?.terminate();
  }

  private post(message: VoiceWorkerMessage): void {
    this.onmessage?.({ data: message } as MessageEvent);
  }

  private setSource(source: VoiceSource): void {
    if (this.source === source) return;
    this.source = source;
    this.post({ type: "source", source });
  }

  private sendReady(): void {
    if (this.readySent) return;
    this.readySent = true;
    this.post({ type: "ready" });
  }

  private wake(): Promise<void> {
    this.waking ??= (async () => {
      this.setSource("waking");
      const ok = await this.deps.warm().catch(() => false);
      this.waking = null;
      if (ok) this.setAwake();
      else this.setDown();
    })();
    return this.waking;
  }

  private setAwake(): void {
    this.failures = 0;
    this.lastLineAt = Date.now();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.sendReady();
    this.setSource("awake");
    const held = this.held;
    this.held = [];
    for (const job of held) void this.viaChatterbox(job);
  }

  private setDown(): void {
    this.setSource("down");
    const held = this.held;
    this.held = [];
    for (const job of held) this.viaKokoro(job);
    if (!this.retryTimer)
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.wake();
      }, this.deps.retryMs ?? 60_000);
    this.noVoiceLeft();
  }

  /** Kokoro failed and Chatterbox is down: the engine falls back to the device voice. */
  private noVoiceLeft(): void {
    if (!this.kokoroFailed || this.source !== "down") return;
    this.readySent = false;
    this.post({ type: "error", message: "No natural voice is available" });
  }

  private route(job: Generate): void {
    if (job.text.length > MAX_LINE) return this.viaKokoro(job);
    if (this.source === "awake" && Date.now() - this.lastLineAt > (this.deps.idleMs ?? 300_000)) void this.wake();
    if (this.source === "awake") return void this.viaChatterbox(job);
    if (this.source === "down") return this.viaKokoro(job);
    if (job.urgent && this.kokoroReady && !this.kokoroFailed) return this.viaKokoro(job);
    this.held.push(job);
  }

  private async viaChatterbox(job: Generate): Promise<void> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), job.urgent ? (this.deps.lineWaitMs ?? 6000) : (this.deps.preparedWaitMs ?? 25_000));
    try {
      const { samples, sampleRate } = decodeWav(await this.deps.speak({ text: job.text, voice: job.voice, speed: job.speed }, ctrl.signal));
      this.failures = 0;
      this.lastLineAt = Date.now();
      this.post({ type: "audio", id: job.id, samples, sampleRate });
    } catch (err) {
      const aboutTheRequest = err instanceof SpeakError && err.status >= 400 && err.status < 500;
      if (!aboutTheRequest && ++this.failures >= 2) this.setDown();
      this.viaKokoro(job);
    } finally {
      clearTimeout(timer);
    }
  }

  private viaKokoro(job: Generate): void {
    if (!this.deps.kokoro || this.kokoroFailed) {
      this.post({ type: "error", id: job.id, message: "No backup voice" });
      return;
    }
    this.kokoroJobs.add(job.id);
    this.deps.kokoro.postMessage({ type: "generate", id: job.id, text: job.text, voice: backupVoice(job.voice), speed: job.speed, urgent: job.urgent });
  }

  private fromKokoro(msg: VoiceWorkerMessage): void {
    switch (msg.type) {
      case "ready":
        this.kokoroReady = true;
        this.sendReady();
        return;
      case "progress":
        this.post(msg);
        return;
      case "audio":
        this.kokoroJobs.delete(msg.id);
        this.post({ ...msg, backup: true });
        return;
      case "error":
        if (msg.id === undefined) {
          this.kokoroFailed = true;
          for (const id of this.kokoroJobs) this.post({ type: "error", id, message: msg.message });
          this.kokoroJobs.clear();
          this.noVoiceLeft();
        } else {
          this.kokoroJobs.delete(msg.id);
          this.post(msg);
        }
        return;
      case "source":
        return;
    }
  }
}
