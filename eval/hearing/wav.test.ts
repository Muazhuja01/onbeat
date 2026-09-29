import { describe, expect, it } from "vitest";
import { mixAtSnr, parseWav, rms } from "./wav";

function wav16(samples: number[], sampleRate: number, channels = 1): Uint8Array {
  const data = samples.length * 2;
  const b = new DataView(new ArrayBuffer(44 + data));
  const text = (o: number, s: string) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF");
  b.setUint32(4, 36 + data, true);
  text(8, "WAVE");
  text(12, "fmt ");
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true);
  b.setUint16(22, channels, true);
  b.setUint32(24, sampleRate, true);
  b.setUint32(28, sampleRate * channels * 2, true);
  b.setUint16(32, channels * 2, true);
  b.setUint16(34, 16, true);
  text(36, "data");
  b.setUint32(40, data, true);
  samples.forEach((s, i) => b.setInt16(44 + i * 2, s, true));
  return new Uint8Array(b.buffer);
}

describe("parseWav", () => {
  it("reads 16-bit mono audio as floats", () => {
    const { samples, sampleRate } = parseWav(wav16([0, 16384, -32768], 16000));
    expect(sampleRate).toBe(16000);
    expect(Array.from(samples)).toEqual([0, 0.5, -1]);
  });

  it("keeps the first channel of multichannel audio", () => {
    const { samples } = parseWav(wav16([100, -100, 200, -200], 48000, 2));
    expect(samples.length).toBe(2);
    expect(samples[1]).toBeCloseTo(200 / 32768);
  });
});

describe("mixAtSnr", () => {
  it("scales the noise to the requested signal-to-noise ratio", () => {
    const speech = Float32Array.from({ length: 1600 }, (_, i) => Math.sin(i / 5));
    const noise = Float32Array.from({ length: 4000 }, (_, i) => ((i * 7919) % 13) / 13 - 0.5);
    const mixed = mixAtSnr(speech, noise, 10, 0);
    const added = mixed.map((m, i) => m - speech[i]);
    expect(20 * Math.log10(rms(speech) / rms(added))).toBeCloseTo(10, 1);
  });

  it("returns the speech unchanged when no noise is asked for", () => {
    const speech = Float32Array.from([0.1, 0.2]);
    expect(mixAtSnr(speech, new Float32Array(10), Infinity, 0)).toEqual(speech);
  });
});
