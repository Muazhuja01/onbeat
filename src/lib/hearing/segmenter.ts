import { FRAME, SAMPLE_RATE } from "./audio";

export interface SegmenterOptions {
  /** A frame above this speech probability starts a segment. */
  speechThreshold: number;
  /** While recording, frames at or above this still count as speech. */
  exitThreshold: number;
  /** This much silence ends the partner's turn. */
  endSilenceMs: number;
  /** Segments with less speech than this are noise and are dropped. */
  minSpeechMs: number;
  /** Audio kept from before speech started, and after it ended. */
  padMs: number;
  /** How often to ask for a live caption of the audio so far. */
  partialEveryMs: number;
  /** A turn this long is ended here, even with no pause. */
  maxSegmentMs: number;
  /** A piece of a turn is cut off at a short pause once it is at least this long... */
  chunkMinMs: number;
  /** ...when this much audio in a row is under the speech threshold. */
  chunkPauseMs: number;
  /** A piece with no such pause is cut by this length, at the quietest frame of the last chunkSearchMs. */
  chunkMaxMs: number;
  chunkSearchMs: number;
}

export const DEFAULT_SEGMENTER: SegmenterOptions = {
  speechThreshold: 0.3,
  exitThreshold: 0.1,
  endSilenceMs: 600,
  minSpeechMs: 250,
  padMs: 96,
  partialEveryMs: 500,
  maxSegmentMs: 30_000,
  chunkMinMs: 2000,
  chunkPauseMs: 160,
  chunkMaxMs: 6000,
  chunkSearchMs: 2000,
};

/**
 * start: speech began. partial: time for a live caption of what's pending.
 * chunk: a finished piece of the turn, to transcribe once; later pieces don't include it.
 *   `forced`: it was cut for length rather than at a pause, so it may end mid-sentence.
 * end: the turn is over; `audio` is all of it, `tail` the part after the last chunk (empty when it holds no speech).
 */
export type SegmentEvent =
  | { type: "start" }
  | { type: "partial" }
  | { type: "chunk"; audio: Float32Array; forced: boolean }
  | { type: "end"; audio: Float32Array; tail: Float32Array; silenceMs: number }
  | { type: "discard" };

const toSamples = (ms: number) => Math.round((ms / 1000) * SAMPLE_RATE);
const toMs = (samples: number) => (samples / SAMPLE_RATE) * 1000;

function concat(frames: Float32Array[], length: number): Float32Array {
  const out = new Float32Array(length);
  let offset = 0;
  for (const f of frames) {
    if (offset >= length) break;
    const part = f.subarray(0, length - offset);
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Turns per-frame speech probabilities into speech segments: start, partials, the pieces of a
 * long turn, then end or discard. A turn is cut into pieces of 2 to 6 s so that each piece is
 * transcribed once and a live caption only re-reads the piece being spoken.
 */
export class Segmenter {
  private recording = false;
  private frames: Float32Array[] = [];
  private probabilities: number[] = [];
  private before: Float32Array[] = [];
  private length = 0;
  private silence = 0;
  private voiced = 0;
  private sincePartial = 0;
  /** Frames already sent as chunks. */
  private cut = 0;
  /** Frames in a row under the speech threshold, up to the newest. */
  private pauseFrames = 0;

  constructor(private readonly o: SegmenterOptions = DEFAULT_SEGMENTER) {}

  push(frame: Float32Array, probability: number): SegmentEvent[] {
    if (!this.recording) {
      if (probability <= this.o.speechThreshold) {
        this.before.push(frame);
        if (this.before.length > Math.ceil(toSamples(this.o.padMs) / FRAME)) this.before.shift();
        return [];
      }
      this.recording = true;
      this.frames = [...this.before, frame];
      // Padding frames count as quiet, so a cut never lands inside speech for their sake.
      this.probabilities = [...this.before.map(() => 0), probability];
      this.before = [];
      this.length = this.frames.reduce((n, f) => n + f.length, 0);
      this.voiced = frame.length;
      this.silence = 0;
      this.sincePartial = 0;
      this.cut = 0;
      this.pauseFrames = 0;
      return [{ type: "start" }];
    }

    this.frames.push(frame);
    this.probabilities.push(probability);
    this.length += frame.length;
    this.sincePartial += frame.length;
    this.pauseFrames = probability < this.o.speechThreshold ? this.pauseFrames + 1 : 0;
    if (probability >= this.o.exitThreshold) {
      this.voiced += frame.length;
      this.silence = 0;
    } else {
      this.silence += frame.length;
    }

    if (this.length >= toSamples(this.o.maxSegmentMs)) return [this.finish()];
    if (this.silence >= toSamples(this.o.endSilenceMs)) {
      if (this.voiced < toSamples(this.o.minSpeechMs)) {
        this.clear();
        return [{ type: "discard" }];
      }
      return [this.finish()];
    }
    const events: SegmentEvent[] = [];
    const chunk = this.chunk();
    if (chunk) events.push(chunk);
    if (this.sincePartial >= toSamples(this.o.partialEveryMs) && this.voiced >= toSamples(this.o.minSpeechMs)) {
      this.sincePartial = 0;
      events.push({ type: "partial" });
    }
    return events;
  }

  /** The audio after the last chunk, or null when not recording or it holds too little speech to read. */
  pending(): Float32Array | null {
    if (!this.recording || !this.hasSpeech(this.cut, this.frames.length)) return null;
    return concat(this.frames.slice(this.cut), (this.frames.length - this.cut) * FRAME);
  }

  /** Drop speech in progress (used while the app itself is speaking). */
  reset(): void {
    this.clear();
    this.before = [];
  }

  /** A chunk event when the piece since the last cut should be cut off now. */
  private chunk(): SegmentEvent | null {
    const pieceSamples = (this.frames.length - this.cut) * FRAME;
    let at: number | null = null;
    let forced = false;
    if (pieceSamples >= toSamples(this.o.chunkMinMs) && this.pauseFrames * FRAME >= toSamples(this.o.chunkPauseMs)) {
      at = this.frames.length;
    } else if (pieceSamples >= toSamples(this.o.chunkMaxMs)) {
      // Cut just after the quietest frame of the last chunkSearchMs, to split as few words as possible.
      const from = Math.max(this.cut + 1, this.frames.length - Math.ceil(toSamples(this.o.chunkSearchMs) / FRAME));
      let quietest = from;
      for (let i = from; i < this.frames.length; i++) if (this.probabilities[i] < this.probabilities[quietest]) quietest = i;
      at = quietest + 1;
      forced = true;
    }
    if (at === null || !this.hasSpeech(this.cut, at)) return null;
    const audio = concat(this.frames.slice(this.cut, at), (at - this.cut) * FRAME);
    this.cut = at;
    return { type: "chunk", audio, forced };
  }

  /** Whether frames [from, to) hold at least minSpeechMs of speech. */
  private hasSpeech(from: number, to: number): boolean {
    let voiced = 0;
    for (let i = from; i < to; i++) if (this.probabilities[i] >= this.o.exitThreshold) voiced += FRAME;
    return voiced >= toSamples(this.o.minSpeechMs);
  }

  private finish(): SegmentEvent {
    const keep = this.length - Math.max(0, this.silence - toSamples(this.o.padMs));
    const keptFrames = Math.ceil(keep / FRAME);
    const tailStart = this.cut * FRAME;
    const tail =
      keep > tailStart && this.hasSpeech(this.cut, keptFrames)
        ? concat(this.frames.slice(this.cut), keep - tailStart)
        : new Float32Array(0);
    const event: SegmentEvent = { type: "end", audio: concat(this.frames, keep), tail, silenceMs: toMs(this.silence) };
    this.clear();
    return event;
  }

  private clear(): void {
    this.recording = false;
    this.frames = [];
    this.probabilities = [];
    this.length = 0;
    this.silence = 0;
    this.voiced = 0;
    this.sincePartial = 0;
    this.cut = 0;
    this.pauseFrames = 0;
  }
}
