import type { WorkerLike } from "@/lib/worker-like";
import type { VoiceWorkerMessage } from "./messages";

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
type Clip = { samples: Float32Array; sampleRate: number };
/** start/end are replies (what the user said); sampleStart/sampleEnd are voice samples. */
type Events = { start: string; end: string; sampleStart: string; sampleEnd: string; mode: VoiceMode; progress: number };

/** A sample's first use of a voice downloads that voice's file, so it can wait much longer than a reply. */
const SAMPLE_WAIT_MS = 20_000;

export interface VoiceEngineDeps {
  worker: WorkerLike | null;
  audio: AudioOut;
  basic: BasicSpeech;
  voice: () => string;
  speed: () => number;
  naturalWaitMs?: number;
  cacheSize?: number;
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
  private listeners: { [K in keyof Events]: Set<(v: Events[K]) => void> } = {
    start: new Set(),
    end: new Set(),
    sampleStart: new Set(),
    sampleEnd: new Set(),
    mode: new Set(),
    progress: new Set(),
  };
  private clips = new Map<string, Promise<Clip>>();
  private pending = new Map<number, { resolve: (c: Clip) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private token = 0;
  private playing: { text: string; sample: boolean } | null = null;

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
    if (t && this.mode === "natural") this.clip(t).catch(() => {});
  }

  /** Speaks a reply in the current voice. */
  speak(text: string): Promise<void> {
    return this.play(text, this.deps.naturalWaitMs ?? 1500);
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
      const clip = this.mode === "natural" ? await withTimeout(this.clip(t, as), waitMs) : null;
      if (token !== this.token) return;
      if (clip) await this.deps.audio.play(clip.samples, clip.sampleRate);
      else await this.deps.basic.speak(t, as?.speed ?? this.deps.speed());
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

  private clip(text: string, as?: VoiceOverride): Promise<Clip> {
    const voice = as?.voice ?? this.deps.voice();
    const speed = as?.speed ?? this.deps.speed();
    const key = `${voice}|${speed}|${text}`;
    const existing = this.clips.get(key);
    if (existing) {
      this.clips.delete(key);
      this.clips.set(key, existing);
      return existing;
    }
    const id = this.nextId++;
    const promise = new Promise<Clip>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    promise.catch(() => this.clips.delete(key));
    this.clips.set(key, promise);
    while (this.clips.size > (this.deps.cacheSize ?? 30)) this.clips.delete(this.clips.keys().next().value as string);
    this.deps.worker?.postMessage({ type: "generate", id, text, voice, speed });
    return promise;
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
        if (!p) return;
        this.pending.delete(msg.id);
        p.resolve({ samples: msg.samples, sampleRate: msg.sampleRate });
        return;
      }
      case "error": {
        if (msg.id === undefined) {
          this.setMode("basic");
          for (const p of this.pending.values()) p.reject(new Error(msg.message));
          this.pending.clear();
          this.clips.clear();
          return;
        }
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        p.reject(new Error(msg.message));
      }
    }
  }
}
