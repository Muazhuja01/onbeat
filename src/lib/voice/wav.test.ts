import { describe, expect, it } from "vitest";
import { decodeWav } from "./wav";

function wav(samples: number[], sampleRate = 24000, channels = 1, bits = 16): ArrayBuffer {
  const data = samples.length * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, bits, true);
  text(36, "data");
  v.setUint32(40, data, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, s, true));
  return buf;
}

describe("decodeWav", () => {
  it("reads 16-bit mono PCM", () => {
    const { samples, sampleRate } = decodeWav(wav([0, 16384, -32768, 32767]));
    expect(sampleRate).toBe(24000);
    expect(Array.from(samples)).toEqual([0, 0.5, -1, 32767 / 32768]);
  });

  it("averages stereo to mono", () => {
    expect(Array.from(decodeWav(wav([16384, 0, -16384, -16384], 24000, 2)).samples)).toEqual([0.25, -0.5]);
  });

  it("refuses empty audio, other formats and junk", () => {
    expect(() => decodeWav(wav([]))).toThrow();
    expect(() => decodeWav(wav([1, 2], 24000, 1, 8))).toThrow();
    expect(() => decodeWav(new TextEncoder().encode("not audio").buffer as ArrayBuffer)).toThrow();
  });
});
