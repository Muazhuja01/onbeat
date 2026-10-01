/** The voice server's clip (16-bit PCM WAV) as samples the engine can play. Throws on anything else, including an empty clip. */
export function decodeWav(buffer: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
  const v = new DataView(buffer);
  const tag = (at: number) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
  if (buffer.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let channels = 0;
  let sampleRate = 0;
  let at = 12;
  while (at + 8 <= buffer.byteLength) {
    const id = tag(at);
    const size = v.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      const format = v.getUint16(body, true);
      channels = v.getUint16(body + 2, true);
      sampleRate = v.getUint32(body + 4, true);
      const bits = v.getUint16(body + 14, true);
      if (format !== 1 || bits !== 16 || channels < 1) throw new Error("not 16-bit PCM");
    } else if (id === "data") {
      if (!channels) throw new Error("data before format");
      const frames = Math.floor(Math.min(size, buffer.byteLength - body) / (2 * channels));
      if (frames < 1) throw new Error("empty clip");
      const samples = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        for (let ch = 0; ch < channels; ch++) sum += v.getInt16(body + (f * channels + ch) * 2, true);
        samples[f] = sum / channels / 32768;
      }
      return { samples, sampleRate };
    }
    at = body + size + (size % 2);
  }
  throw new Error("no audio data");
}
