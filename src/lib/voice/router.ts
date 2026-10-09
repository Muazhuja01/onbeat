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

/** The most the voice server takes in one request. A longer line is made in parts and joined. */
export const MAX_LINE = 300;

/** Splits a line into parts of at most `max` characters: at sentence ends where it can, then after commas, then at spaces. */
export function splitLine(text: string, max: number): string[] {
  const pieces = (t: string, seps: RegExp[]): string[] => {
    if (t.length <= max) return [t];
    const [sep, ...rest] = seps;
    // A single word longer than a part: cut it rather than go over.
    if (!sep) return t.match(new RegExp(`[^]{1,${max}}`, "g")) ?? [];
    return t.split(sep).flatMap((piece) => pieces(piece, rest));
  };
  const parts: string[] = [];
  for (const piece of pieces(text.trim(), [/(?<=[.!?])\s+/, /(?<=[,;:])\s+/, /\s+/])) {
    const last = parts.at(-1);
    if (last !== undefined && last.length + 1 + piece.length <= max) parts[parts.length - 1] = `${last} ${piece}`;
    else parts.push(piece);
  }
  return parts;
}

/** The parts' clips as one. */
function joinClips(clips: { samples: Float32Array; sampleRate: number }[]): { samples: Float32Array; sampleRate: number } {
  const { sampleRate } = clips[0];
  if (clips.some((c) => c.sampleRate !== sampleRate)) throw new Error("parts at different sample rates");
  const samples = new Float32Array(clips.reduce((n, c) => n + c.samples.length, 0));
  let at = 0;
  for (const c of clips) {
    samples.set(c.samples, at);
    at += c.samples.length;
  }
  return { samples, sampleRate };
}

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
/** `parts`: how many requests the line takes; each gets the full wait. */
type InFlight = { job: Generate; parts: number; ctrl: AbortController; deadline: number; timer: ReturnType<typeof setTimeout> };

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
  /** Lines waiting for Chatterbox to wake. */
  private held: Generate[] = [];
  /**
   * The voice server and Kokoro both make lines in the order they arrive, so the router keeps
   * the lines back itself: one prepared line at a time with Chatterbox (a line being said goes
   * at once, behind that one at most), and one line at a time with Kokoro, the line being said first.
   */
  private queued: Generate[] = [];
  /** The line sent to Chatterbox as prepared and not answered yet. */
  private preparedId: number | null = null;
  private kokoroQueue: Generate[] = [];
  /** The line Kokoro is making. */
  private kokoroBusy: Generate | null = null;
  /** Lines sent to Chatterbox and not answered yet, with when each gives up. */
  private inFlight = new Map<number, InFlight>();
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
    if (msg.type === "urgent") return this.nowUrgent(msg.id);
    this.route(msg);
  }

  terminate(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    for (const f of this.inFlight.values()) {
      clearTimeout(f.timer);
      f.ctrl.abort();
    }
    this.held = [];
    this.queued = [];
    this.kokoroQueue = [];
    this.deps.kokoro?.terminate();
  }

  /**
   * A line sent earlier as prepared is now being said. Held: handle it as urgent now. Waiting its
   * turn for Chatterbox: it goes at once. Waiting for Kokoro: it goes next. With Chatterbox: it
   * gets the urgent wait from now (never longer than it had), then goes to Kokoro. Lines Kokoro is
   * making, answered or unknown need nothing.
   */
  private nowUrgent(id: number): void {
    const at = this.held.findIndex((j) => j.id === id);
    if (at >= 0) {
      const job = { ...this.held[at], urgent: true };
      if (this.kokoroReady && !this.kokoroFailed) {
        this.held.splice(at, 1);
        this.viaKokoro(job);
      } else this.held[at] = job;
      return;
    }
    const waiting = this.queued.findIndex((j) => j.id === id);
    if (waiting >= 0) {
      const [job] = this.queued.splice(waiting, 1);
      return void this.viaChatterbox({ ...job, urgent: true });
    }
    const backup = this.kokoroQueue.findIndex((j) => j.id === id);
    if (backup >= 0) {
      const [job] = this.kokoroQueue.splice(backup, 1);
      return this.viaKokoro({ ...job, urgent: true });
    }
    const f = this.inFlight.get(id);
    if (!f || f.job.urgent) return;
    f.job = { ...f.job, urgent: true };
    const deadline = Math.min(f.deadline, Date.now() + (this.deps.lineWaitMs ?? 6000) * f.parts);
    if (deadline === f.deadline) return;
    clearTimeout(f.timer);
    f.deadline = deadline;
    f.timer = setTimeout(() => f.ctrl.abort(), deadline - Date.now());
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
      // A retry while down stays down (lines keep going to Kokoro) until it succeeds.
      if (this.source !== "down") {
        this.setSource("waking");
        // Prepared lines waiting their turn wait for the wake now, like new ones.
        this.held.unshift(...this.queued);
        this.queued = [];
      }
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
    for (const job of held) this.toChatterbox(job);
  }

  private setDown(): void {
    this.setSource("down");
    const waiting = [...this.queued, ...this.held];
    this.queued = [];
    this.held = [];
    for (const job of waiting) this.viaKokoro(job);
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
    if (this.source === "awake" && Date.now() - this.lastLineAt > (this.deps.idleMs ?? 300_000)) void this.wake();
    if (this.source === "awake") return this.toChatterbox(job);
    if (this.source === "down") return this.viaKokoro(job);
    if (job.urgent && this.kokoroReady && !this.kokoroFailed) return this.viaKokoro(job);
    this.held.push(job);
  }

  /** A line being said goes at once; a prepared one waits its turn. */
  private toChatterbox(job: Generate): void {
    if (job.urgent) return void this.viaChatterbox(job);
    this.queued.push(job);
    this.nextPrepared();
  }

  /** Sends the next prepared line when Chatterbox is awake and has none. */
  private nextPrepared(): void {
    if (this.source !== "awake" || this.preparedId !== null) return;
    const job = this.queued.shift();
    if (!job) return;
    this.preparedId = job.id;
    void this.viaChatterbox(job);
  }

  private async viaChatterbox(job: Generate): Promise<void> {
    const ctrl = new AbortController();
    const parts = splitLine(job.text, MAX_LINE);
    const wait = (job.urgent ? (this.deps.lineWaitMs ?? 6000) : (this.deps.preparedWaitMs ?? 25_000)) * parts.length;
    const f: InFlight = { job, parts: parts.length, ctrl, deadline: Date.now() + wait, timer: setTimeout(() => ctrl.abort(), wait) };
    this.inFlight.set(job.id, f);
    try {
      // One part after another: asking for the next at once could start a second, cold, server.
      const clips = [];
      for (const text of parts) clips.push(decodeWav(await this.deps.speak({ text, voice: job.voice, speed: job.speed }, ctrl.signal)));
      const { samples, sampleRate } = joinClips(clips);
      this.failures = 0;
      this.lastLineAt = Date.now();
      this.post({ type: "audio", id: job.id, samples, sampleRate });
    } catch (err) {
      const aboutTheRequest = err instanceof SpeakError && err.status >= 400 && err.status < 500;
      const down = !aboutTheRequest && ++this.failures >= 2;
      // f.job, not job: the line may have become urgent while it was in flight. It goes to Kokoro
      // before the prepared lines that were waiting behind it.
      this.viaKokoro(f.job);
      if (down) this.setDown();
    } finally {
      clearTimeout(f.timer);
      this.inFlight.delete(job.id);
      if (this.preparedId === job.id) this.preparedId = null;
      this.nextPrepared();
    }
  }

  /** Kokoro makes one line at a time; the line being said goes first. */
  private viaKokoro(job: Generate): void {
    if (!this.deps.kokoro || this.kokoroFailed) {
      this.post({ type: "error", id: job.id, message: "No backup voice" });
      return;
    }
    if (job.urgent) this.kokoroQueue.unshift(job);
    else this.kokoroQueue.push(job);
    this.nextKokoro();
  }

  private nextKokoro(): void {
    if (this.kokoroBusy || !this.deps.kokoro || this.kokoroFailed) return;
    const job = this.kokoroQueue.shift();
    if (!job) return;
    this.kokoroBusy = job;
    this.deps.kokoro.postMessage({ type: "generate", id: job.id, text: job.text, voice: backupVoice(job.voice), speed: job.speed, urgent: job.urgent });
  }

  private fromKokoro(msg: VoiceWorkerMessage): void {
    switch (msg.type) {
      case "ready": {
        this.kokoroReady = true;
        this.sendReady();
        // Lines being said were held only because there was no backup yet.
        const now = this.held.filter((j) => j.urgent);
        this.held = this.held.filter((j) => !j.urgent);
        for (const job of now) this.viaKokoro(job);
        return;
      }
      case "progress":
        this.post(msg);
        return;
      case "audio":
        // Only the line Kokoro was given: nothing is answered twice.
        if (msg.id !== this.kokoroBusy?.id) return;
        this.kokoroBusy = null;
        this.post({ ...msg, backup: true });
        this.nextKokoro();
        return;
      case "error":
        if (msg.id === undefined) {
          this.kokoroFailed = true;
          const lost = [...(this.kokoroBusy ? [this.kokoroBusy] : []), ...this.kokoroQueue];
          this.kokoroBusy = null;
          this.kokoroQueue = [];
          for (const job of lost) this.post({ type: "error", id: job.id, message: msg.message });
          this.noVoiceLeft();
        } else if (msg.id === this.kokoroBusy?.id) {
          this.kokoroBusy = null;
          this.post(msg);
          this.nextKokoro();
        }
        return;
      case "source":
        return;
    }
  }
}
