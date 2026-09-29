import { describe, expect, it } from "vitest";
import { FRAME, Framer, levelOf, maxTranscriptTokens, Resampler, SAMPLE_RATE } from "./audio";

describe("Framer", () => {
  it("cuts chunks of any size into 512-sample frames, in order", () => {
    const framer = new Framer();
    const frames: Float32Array[] = [];
    const ramp = Float32Array.from({ length: 1100 }, (_, i) => i);
    framer.push(ramp.subarray(0, 700), (f) => frames.push(f));
    framer.push(ramp.subarray(700), (f) => frames.push(f));
    expect(frames).toHaveLength(2);
    expect(frames.every((f) => f.length === FRAME)).toBe(true);
    expect([frames[0][0], frames[1][0], frames[1][511]]).toEqual([0, 512, 1023]);
    expect(frames[0]).not.toBe(frames[1]);
  });

  it("drops a half-filled frame on reset", () => {
    const framer = new Framer();
    const frames: Float32Array[] = [];
    framer.push(new Float32Array(300).fill(1), (f) => frames.push(f));
    framer.reset();
    framer.push(new Float32Array(FRAME).fill(2), (f) => frames.push(f));
    expect(frames).toHaveLength(1);
    expect(frames[0][0]).toBe(2);
  });
});

describe("Resampler", () => {
  it("returns 16 kHz input unchanged", () => {
    const input = new Float32Array([1, 2, 3]);
    expect(new Resampler(16_000).push(input)).toBe(input);
  });

  it("keeps every third sample of 48 kHz audio across chunk boundaries", () => {
    const resampler = new Resampler(48_000);
    const ramp = Float32Array.from({ length: 3000 }, (_, i) => i);
    const out = [0, 1000, 2000].flatMap((start) => Array.from(resampler.push(ramp.subarray(start, start + 1000))));
    expect(out).toEqual(Array.from({ length: 1000 }, (_, i) => i * 3));
  });

  it("turns one second of 44.1 kHz audio into about 16000 samples", () => {
    const resampler = new Resampler(44_100);
    let n = 0;
    for (let i = 0; i < 44_100; i += 441) n += resampler.push(new Float32Array(441)).length;
    expect(Math.abs(n - 16_000)).toBeLessThanOrEqual(1);
  });
});

describe("levelOf", () => {
  it("is 0 for silence and 1 for loud audio", () => {
    expect(levelOf(new Float32Array(512))).toBe(0);
    expect(levelOf(new Float32Array(512).fill(1))).toBe(1);
    expect(levelOf(new Float32Array(512).fill(0.1))).toBeCloseTo(0.5);
    expect(levelOf(new Float32Array(0))).toBe(0);
  });
});

describe("maxTranscriptTokens", () => {
  const seconds = (s: number) => Math.round(s * SAMPLE_RATE);

  // Transformers.js caps Moonshine at floor(seconds) * 6 tokens: 0 under a
  // second ("Give me your name." came out as "Give") and 6 under two seconds.
  it("leaves room for a whole short question", () => {
    // "What's your name?" said quickly: about 0.9 s, 5 tokens.
    expect(maxTranscriptTokens(seconds(0.93))).toBeGreaterThanOrEqual(12);
    // "Okay, can I have your name written on it?": about 2 s, 11 tokens.
    expect(maxTranscriptTokens(seconds(1.98))).toBeGreaterThanOrEqual(20);
  });

  it("grows with the audio but stays bounded, so a looping decode stops", () => {
    expect(maxTranscriptTokens(seconds(8))).toBeGreaterThan(maxTranscriptTokens(seconds(2)));
    expect(maxTranscriptTokens(seconds(30))).toBeLessThanOrEqual(250);
  });
});
