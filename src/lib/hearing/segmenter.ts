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
  /** How often to send the audio so far for a live caption. */
  partialEveryMs: number;
  /** Moonshine handles at most 30 s; longer speech is cut here. */
  maxSegmentMs: number;
}

export const DEFAULT_SEGMENTER: SegmenterOptions = {
  speechThreshold: 0.3,
  exitThreshold: 0.1,
  endSilenceMs: 600,
  minSpeechMs: 250,
  padMs: 96,
  partialEveryMs: 500,
  maxSegmentMs: 30_000,
};

export type SegmentEvent =
  | { type: "start" }
  | { type: "partial"; audio: Float32Array }
  | { type: "end"; audio: Float32Array; silenceMs: number }
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

/** Turns per-frame speech probabilities into speech segments: start, partial snapshots, end or discard. */
export class Segmenter {
  private recording = false;
  private frames: Float32Array[] = [];
  private before: Float32Array[] = [];
  private length = 0;
  private silence = 0;
  private voiced = 0;
  private sincePartial = 0;

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
      this.before = [];
      this.length = this.frames.reduce((n, f) => n + f.length, 0);
      this.voiced = frame.length;
      this.silence = 0;
      this.sincePartial = 0;
      return [{ type: "start" }];
    }

    this.frames.push(frame);
    this.length += frame.length;
    this.sincePartial += frame.length;
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
    if (this.sincePartial >= toSamples(this.o.partialEveryMs) && this.voiced >= toSamples(this.o.minSpeechMs)) {
      this.sincePartial = 0;
      return [{ type: "partial", audio: concat(this.frames, this.length) }];
    }
    return [];
  }

  /** Drop speech in progress (used while the app itself is speaking). */
  reset(): void {
    this.clear();
    this.before = [];
  }

  private finish(): SegmentEvent {
    const keep = this.length - Math.max(0, this.silence - toSamples(this.o.padMs));
    const event: SegmentEvent = { type: "end", audio: concat(this.frames, keep), silenceMs: toMs(this.silence) };
    this.clear();
    return event;
  }

  private clear(): void {
    this.recording = false;
    this.frames = [];
    this.length = 0;
    this.silence = 0;
    this.voiced = 0;
    this.sincePartial = 0;
  }
}
