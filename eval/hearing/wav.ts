export { encodeWav } from "@/lib/hearing/wav";
/** Reads a PCM WAV file (16-bit integer or 32-bit float) and returns its first channel. */
export function parseWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let format = 0;
  let channels = 1;
  let sampleRate = 0;
  let bits = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = v.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = v.getUint16(body, true);
      channels = v.getUint16(body + 2, true);
      sampleRate = v.getUint32(body + 4, true);
      bits = v.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE keeps the real format code in its sub-format GUID.
      if (format === 0xfffe) format = v.getUint16(body + 24, true);
    } else if (id === "data") {
      const width = bits / 8;
      const end = Math.min(body + size, bytes.length);
      const frames = Math.floor((end - body) / (width * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        const at = body + i * width * channels;
        if (format === 3 && bits === 32) samples[i] = v.getFloat32(at, true);
        else if (format === 1 && bits === 16) samples[i] = v.getInt16(at, true) / 32768;
        else if (format === 1 && bits === 32) samples[i] = v.getInt32(at, true) / 2147483648;
        else throw new Error(`unsupported WAV format ${format}/${bits}`);
      }
      return { samples, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV file has no data");
}

export function rms(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / (samples.length || 1));
}

/**
 * How much to scale `noise` (read from `noiseOffset`, wrapping round) so that
 * speech level / noise level under the speech is `snrDb`. Infinity means no noise.
 */
export function noiseGain(speech: Float32Array, noise: Float32Array, snrDb: number, noiseOffset: number): number {
  if (!Number.isFinite(snrDb)) return 0;
  const piece = new Float32Array(speech.length);
  for (let i = 0; i < speech.length; i++) piece[i] = noise[(noiseOffset + i) % noise.length];
  return rms(speech) / (rms(piece) * 10 ** (snrDb / 20) || 1);
}

/** Speech with noise added at `snrDb`. */
export function mixAtSnr(speech: Float32Array, noise: Float32Array, snrDb: number, noiseOffset: number): Float32Array {
  const gain = noiseGain(speech, noise, snrDb, noiseOffset);
  if (gain === 0) return speech;
  return speech.map((s, i) => s + noise[(noiseOffset + i) % noise.length] * gain);
}

