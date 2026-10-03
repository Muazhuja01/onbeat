import type { HearingWorkerMessage } from "./messages";
import { Segmenter, type SegmentEvent } from "./segmenter";
import { joinPieces } from "./transcript";

export interface LiveTranscriberDeps {
  /** Speech probability (0 to 1) of one frame. */
  vad: (frame: Float32Array) => Promise<number>;
  transcribe: (audio: Float32Array) => Promise<{ text: string; ms: number }>;
  post: (message: HearingWorkerMessage, transfer?: Transferable[]) => void;
  segmenter?: Segmenter;
  /** A frame or a read failed; `context` is "vad", "chunk", "partial" or "turnEnd". */
  onError?: (context: string, err: unknown) => void;
}

/** Work that must happen in order: a turn's start, its pieces, then its end. */
type Job =
  | { type: "start" }
  | { type: "chunk"; audio: Float32Array; forced: boolean }
  | { type: "end"; audio: Float32Array; tail: Float32Array; endedAt: number };

/**
 * Turns microphone frames into live captions and finished turns. Each piece of a long turn is
 * read once, so a live caption only re-reads the piece being spoken. Frames always go through
 * speech detection before any reading, and a live caption reads the newest audio when it runs,
 * so a slow read is never followed by a queue of stale ones.
 */
export class LiveTranscriber {
  private readonly segmenter: Segmenter;
  private frames: { frame: Float32Array; at: number }[] = [];
  private jobs: Job[] = [];
  private partialWanted = false;
  /** The current turn's finished pieces. */
  private pieces: { text: string; forced: boolean }[] = [];
  /** The latest live reading of the piece being spoken, without the finished pieces. */
  private live = "";
  /** Bumped by reset, so work begun before it is dropped. */
  private generation = 0;
  private running: Promise<void> | null = null;

  constructor(private readonly deps: LiveTranscriberDeps) {
    this.segmenter = deps.segmenter ?? new Segmenter();
  }

  /** A 32 ms frame of 16 kHz audio; `at` is when it arrived (ms since epoch). */
  push(frame: Float32Array, at: number): void {
    this.frames.push({ frame, at });
    this.kick();
  }

  /** Drop speech in progress and everything queued (used while the app itself is speaking). */
  reset(): void {
    this.generation++;
    this.frames = [];
    this.jobs = [];
    this.partialWanted = false;
    this.pieces = [];
    this.live = "";
    this.segmenter.reset();
  }

  /** Resolves once everything queued is done. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private kick(): void {
    this.running ??= this.pump().finally(() => {
      this.running = null;
      if (this.frames.length || this.jobs.length || this.partialWanted) this.kick();
    });
  }

  private async pump(): Promise<void> {
    for (;;) {
      const gen = this.generation;
      const next = this.frames.shift();
      if (next) {
        let probability: number;
        try {
          probability = await this.deps.vad(next.frame);
        } catch (err) {
          this.deps.onError?.("vad", err);
          continue;
        }
        if (gen === this.generation) this.handle(this.segmenter.push(next.frame, probability), next.at);
        continue;
      }
      const job = this.jobs.shift();
      if (job) {
        await this.run(job, gen);
        continue;
      }
      if (this.partialWanted) {
        this.partialWanted = false;
        await this.partial(gen);
        continue;
      }
      return;
    }
  }

  private handle(events: SegmentEvent[], at: number): void {
    for (const e of events) {
      if (e.type === "start") this.jobs.push({ type: "start" });
      else if (e.type === "partial") this.partialWanted = true;
      else if (e.type === "chunk") this.jobs.push({ type: "chunk", audio: e.audio, forced: e.forced });
      else if (e.type === "end") {
        this.partialWanted = false;
        this.jobs.push({ type: "end", audio: e.audio, tail: e.tail, endedAt: at - e.silenceMs });
      }
    }
  }

  private async run(job: Job, gen: number): Promise<void> {
    if (job.type === "start") {
      this.pieces = [];
      this.live = "";
      this.deps.post({ type: "speechStart" });
      return;
    }
    if (job.type === "chunk") {
      let text = "";
      try {
        ({ text } = await this.deps.transcribe(job.audio));
      } catch (err) {
        this.deps.onError?.("chunk", err);
      }
      if (gen !== this.generation) return;
      text = this.settle(text);
      if (text) this.pieces.push({ text, forced: job.forced });
      return;
    }
    let tail = "";
    let ms = 0;
    if (job.tail.length) {
      try {
        ({ text: tail, ms } = await this.deps.transcribe(job.tail));
      } catch (err) {
        // Still end the turn with what was read, so the page never waits for it.
        this.deps.onError?.("turnEnd", err);
      }
    }
    if (gen !== this.generation) return;
    tail = job.tail.length ? this.settle(tail) : "";
    this.live = "";
    const text = joinPieces([...this.pieces, { text: tail, forced: false }]);
    this.pieces = [];
    // Sent even when empty, so the page can clear a live caption. The audio goes along for cloud captions.
    this.deps.post({ type: "turnEnd", text, endedAt: job.endedAt, ms, audio: job.audio }, [job.audio.buffer as ArrayBuffer]);
  }

  /** A live caption: the finished pieces, then the piece being spoken, read as it is now. */
  private async partial(gen: number): Promise<void> {
    const audio = this.segmenter.pending();
    if (!audio) return;
    try {
      const { text, ms } = await this.deps.transcribe(audio);
      if (gen !== this.generation) return;
      this.live = text;
      const caption = joinPieces([...this.pieces, { text, forced: false }]);
      if (caption) this.deps.post({ type: "partial", text: caption, ms });
    } catch (err) {
      this.deps.onError?.("partial", err);
    }
  }

  /**
   * A finished piece's text: its own reading, unless that has under half the words of its last
   * live reading. The speech model sometimes loops or drops words on a piece ("year 10, 10, 10"
   * trimmed to "10,"), and the live reading of nearly the same audio is then the better text.
   */
  private settle(text: string): string {
    const live = this.live;
    this.live = "";
    return words(text) * 2 < words(live) ? live : text;
  }
}

const words = (text: string) => text.split(/s+/).filter(Boolean).length;
