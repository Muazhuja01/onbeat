import type { WorkerLike } from "@/lib/worker-like";
import type { VoiceSource, VoiceWorkerMessage } from "./messages";

export type VoiceMode = "loading" | "natural" | "basic";

export interface AudioOut {
  /** Resolves when playback finishes or is stopped. */
  play(samples: Float32Array, sampleRate: number): Promise<void>;
  stop(): void;
}

export interface BasicSpeech {
  /** Resolves when speech finishes, errors or is cancelled. */
  speak(text: string, rate: number): Promise<void>;
  stop(): void;
}

/** One line spoken in a different voice and speed, leaving the current voice alone. */
export type VoiceOverride = { voice: string; speed: number };
type Clip = { samples: Float32Array; sampleRate: number; backup?: boolean };
type Entry = { id: number; promise: Promise<Clip>; value?: Clip };
type Job = { id: number; key: string; text: string; voice: string; speed: number; urgent: boolean };
/**
 * start/end are replies (what the user said); sampleStart/sampleEnd are voice samples.
 * waiting is on while a reply waits for its clip in the chosen voice; fallback names a reply
 * the device voice said because that clip failed or took too long.
 * backup names a reply said by the backup voice because Chatterbox couldn't make it in time.
 */
type Events = {
  start: string;
  end: string;
  sampleStart: string;
  sampleEnd: string;
  mode: VoiceMode;
  progress: number;
  waiting: boolean;
  fallback: string;
  source: VoiceSource;
  backup: string;
};

/**
 * Once the natural voice is ready, a reply waits this long for its clip rather than being said
 * in the device's voice, which sounds nothing like the one the user chose. A clip takes a few
 * seconds on a laptop's processor; a sample's first use of a voice also downloads its file.
 */
const REPLY_WAIT_MS = 20_000;
const SAMPLE_WAIT_MS = 20_000;

export interface VoiceEngineDeps {
  worker: WorkerLike | null;
  audio: AudioOut;
  basic: BasicSpeech;
  voice: () => string;
  speed: () => number;
  naturalWaitMs?: number;
  cacheSize?: number;
  /** Lines in progress at once. The Kokoro worker makes one at a time; the router can do more. */
  parallel?: number;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export class VoiceEngine {
  mode: VoiceMode = "loading";
  source: VoiceSource = "waking";
  private lastReplies: string[] = [];
  private listeners: { [K in keyof Events]: Set<(v: Events[K]) => void> } = {
    start: new Set(),
    end: new Set(),
    sampleStart: new Set(),
    sampleEnd: new Set(),
    mode: new Set(),
    progress: new Set(),
    waiting: new Set(),
    fallback: new Set(),
    source: new Set(),
    backup: new Set(),
  };
  private clips = new Map<string, Entry>();
  private pending = new Map<number, { resolve: (c: Clip) => void; reject: (e: Error) => void }>();
  /** Clips not yet sent to the worker. It has limited room, so what is said next goes first. */
  private queue: Job[] = [];
  /** The clips the worker is making now, by id. */
  private busy = new Map<number, Job>();
  private nextId = 1;
  private token = 0;
  private playing: { text: string; sample: boolean } | null = null;
  private waitingNow = false;

  constructor(private readonly deps: VoiceEngineDeps) {
    if (deps.worker) deps.worker.onmessage = (e: MessageEvent) => this.onWorkerMessage(e.data as VoiceWorkerMessage);
  }

  /** The reply being spoken; a sample is not one. */
  get current(): string | null {
    return this.playing && !this.playing.sample ? this.playing.text : null;
  }

  on<K extends keyof Events>(event: K, cb: (v: Events[K]) => void): () => void {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  load(): void {
    if (!this.deps.worker) {
      this.setMode("basic");
      return;
    }
    this.deps.worker.postMessage({ type: "load" });
  }

  prepare(text: string): void {
    const t = text.trim();
    if (t && this.mode === "natural") this.clip(t).promise.catch(() => {});
  }

  /**
   * Prepares the replies on screen. Clips for earlier replies that the worker hasn't started are
   * dropped, so it never works through replies nobody can tap any more.
   */
  prepareReplies(texts: string[]): void {
    this.lastReplies = texts;
    if (this.mode !== "natural") return;
    const keep = new Set(texts.map((t) => this.keyFor(t.trim())));
    for (const job of this.queue.filter((j) => !j.urgent && !keep.has(j.key))) this.drop(job);
    for (const t of texts) this.prepare(t);
  }

  /** Speaks a reply in the current voice. */
  speak(text: string): Promise<void> {
    return this.play(text, this.deps.naturalWaitMs ?? REPLY_WAIT_MS);
  }

  /**
   * Plays a sample of another voice without changing the current one. It waits for that
   * voice rather than playing the device's, and it is not a reply, so it emits
   * sampleStart/sampleEnd instead of start/end.
   */
  sample(text: string, as: VoiceOverride): Promise<void> {
    return this.play(text, SAMPLE_WAIT_MS, as);
  }

  stop(): void {
    const was = this.playing;
    this.token++;
    this.playing = null;
    this.setWaiting(false);
    this.deps.audio.stop();
    this.deps.basic.stop();
    if (was) this.emit(was.sample ? "sampleEnd" : "end", was.text);
  }

  private async play(text: string, waitMs: number, as?: VoiceOverride): Promise<void> {
    const t = text.trim();
    if (!t) return;
    this.stop();
    const token = ++this.token;
    const now = { text: t, sample: as !== undefined };
    this.playing = now;
    this.emit(now.sample ? "sampleStart" : "start", t);
    try {
      const natural = this.mode === "natural";
      let clip: Clip | null = null;
      if (natural) {
        const entry = this.clip(t, as, true);
        // The sample picker shows its own "Preparing sample".
        if (!entry.value && !now.sample) this.setWaiting(true);
        clip = entry.value ?? (await withTimeout(entry.promise, waitMs));
      }
      if (token !== this.token) return;
      this.setWaiting(false);
      if (clip) {
        if (clip.backup && !now.sample && this.source !== "down") this.emit("backup", t);
        await this.deps.audio.play(clip.samples, clip.sampleRate);
      }
      else {
        // Not silent: the screen says the device voice said it instead.
        if (natural && !now.sample) this.emit("fallback", t);
        await this.deps.basic.speak(t, as?.speed ?? this.deps.speed());
      }
    } finally {
      if (token === this.token && this.playing === now) {
        this.playing = null;
        this.emit(now.sample ? "sampleEnd" : "end", t);
      }
    }
  }

  private emit<K extends keyof Events>(event: K, value: Events[K]): void {
    for (const cb of this.listeners[event]) cb(value);
  }

  private setMode(mode: VoiceMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.emit("mode", mode);
  }

  private setWaiting(on: boolean): void {
    if (this.waitingNow === on) return;
    this.waitingNow = on;
    this.emit("waiting", on);
  }

  private keyFor(text: string, as?: VoiceOverride): string {
    return `${as?.voice ?? this.deps.voice()}|${as?.speed ?? this.deps.speed()}|${text}`;
  }

  /** The clip for a line, made if needed. An urgent one (about to be said) goes to the front. */
  private clip(text: string, as?: VoiceOverride, urgent = false): Entry {
    const key = this.keyFor(text, as);
    const existing = this.clips.get(key);
    if (existing) {
      this.clips.delete(key);
      this.clips.set(key, existing);
      const waiting = this.queue.findIndex((j) => j.key === key);
      if (urgent && waiting >= 0) this.queue.unshift({ ...this.queue.splice(waiting, 1)[0], urgent: true });
      // Already sent as a prepared reply and not answered yet: tell the worker it is now being said.
      const sent = this.busy.get(existing.id);
      if (urgent && sent && !sent.urgent) {
        sent.urgent = true;
        this.deps.worker?.postMessage({ type: "urgent", id: sent.id });
      }
      return existing;
    }
    const id = this.nextId++;
    const entry = { id } as Entry;
    entry.promise = new Promise<Clip>((resolve, reject) =>
      this.pending.set(id, {
        // Set at once, so a line said right after its clip arrives doesn't wait a tick.
        resolve: (value) => resolve((entry.value = value)),
        reject,
      }),
    );
    entry.promise.catch(() => this.clips.get(key) === entry && this.clips.delete(key));
    this.clips.set(key, entry);
    while (this.clips.size > (this.deps.cacheSize ?? 30)) this.clips.delete(this.clips.keys().next().value as string);
    const job: Job = { id, key, text, voice: as?.voice ?? this.deps.voice(), speed: as?.speed ?? this.deps.speed(), urgent };
    if (urgent) this.queue.unshift(job);
    else this.queue.push(job);
    this.pump();
    return entry;
  }

  /** Sends queued clips while the worker has room. */
  private pump(): void {
    if (!this.deps.worker) return;
    while (this.busy.size < (this.deps.parallel ?? 1)) {
      const job = this.queue.shift();
      if (!job) return;
      this.busy.set(job.id, job);
      this.deps.worker.postMessage({ type: "generate", id: job.id, text: job.text, voice: job.voice, speed: job.speed, urgent: job.urgent });
    }
  }

  /** Takes a clip the worker hasn't started off the queue. */
  private drop(job: Job): void {
    this.queue = this.queue.filter((j) => j !== job);
    this.pending.get(job.id)?.reject(new Error("dropped"));
    this.pending.delete(job.id);
  }

  /** A clip finished or failed: the worker has room for the next one. */
  private settled(id: number): void {
    this.busy.delete(id);
    this.pump();
  }

  private onWorkerMessage(msg: VoiceWorkerMessage): void {
    switch (msg.type) {
      case "ready":
        this.setMode("natural");
        return;
      case "progress":
        this.emit("progress", msg.value);
        return;
      case "audio": {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        p?.resolve({ samples: msg.samples, sampleRate: msg.sampleRate, ...(msg.backup ? { backup: true } : {}) });
        this.settled(msg.id);
        return;
      }
      case "error": {
        if (msg.id === undefined) {
          this.setMode("basic");
          for (const p of this.pending.values()) p.reject(new Error(msg.message));
          this.pending.clear();
          this.clips.clear();
          this.queue = [];
          this.busy.clear();
          return;
        }
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        p?.reject(new Error(msg.message));
        this.settled(msg.id);
        return;
      }
      case "source": {
        this.source = msg.source;
        this.emit("source", msg.source);
        if (msg.source === "awake") {
          // Never replay a backup clip once the chosen voice is available.
          for (const [key, entry] of this.clips) if (entry.value?.backup) this.clips.delete(key);
          this.prepareReplies(this.lastReplies);
        }
        return;
      }
    }
  }
}
