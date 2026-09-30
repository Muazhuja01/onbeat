/** Silero VAD and Moonshine both take 16 kHz mono audio. */
export const SAMPLE_RATE = 16_000;
/** Silero VAD v5 reads 512 samples (32 ms) at a time. */
export const FRAME = 512;

/** Collects samples into frames of exactly FRAME samples. */
export class Framer {
  private buffer = new Float32Array(FRAME);
  private filled = 0;

  push(samples: Float32Array, onFrame: (frame: Float32Array) => void): void {
    let i = 0;
    while (i < samples.length) {
      const n = Math.min(FRAME - this.filled, samples.length - i);
      this.buffer.set(samples.subarray(i, i + n), this.filled);
      this.filled += n;
      i += n;
      if (this.filled === FRAME) {
        onFrame(this.buffer);
        this.buffer = new Float32Array(FRAME);
        this.filled = 0;
      }
    }
  }

  reset(): void {
    this.filled = 0;
  }
}

/**
 * Converts audio to 16 kHz with linear interpolation, carrying its position
 * across chunks. Used when the browser won't open the microphone at 16 kHz.
 */
export class Resampler {
  /** Read position in the next chunk; -1 means "the last sample of the previous chunk". */
  private position = 0;
  private previous = 0;

  constructor(
    private readonly from: number,
    private readonly to = SAMPLE_RATE,
  ) {}

  push(input: Float32Array): Float32Array {
    if (this.from === this.to) return input;
    const step = this.from / this.to;
    const out: number[] = [];
    let p = this.position;
    while (p <= input.length - 1) {
      const i = Math.floor(p);
      const frac = p - i;
      const a = i < 0 ? this.previous : input[i];
      const b = frac === 0 ? a : input[i + 1];
      out.push(a + (b - a) * frac);
      p += step;
    }
    this.position = p - input.length;
    if (input.length) this.previous = input[input.length - 1];
    return Float32Array.from(out);
  }
}

/**
 * Most tokens Moonshine may write for this much audio. Transformers.js
 * defaults to floor(seconds) * 6, which is 0 under a second and 6 under two,
 * so short questions were cut to their first word or two. A quick "What's
 * your name?" is about 6 tokens a second; the extra room covers that, and the
 * cap still stops a decode that starts repeating itself.
 */
export function maxTranscriptTokens(samples: number): number {
  return Math.ceil((samples / SAMPLE_RATE) * 8) + 6;
}

/** Loudness from 0 to 1 for the level meter (root mean square, scaled so speech fills most of it). */
export function levelOf(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.min(1, Math.sqrt(sum / samples.length) * 5);
}
