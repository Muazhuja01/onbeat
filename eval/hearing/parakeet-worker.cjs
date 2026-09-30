// Runs Parakeet through sherpa-onnx in its own process. The eval's voice
// detector loads an older ONNX Runtime through transformers.js, and on Windows
// both can't live in one process. Reads one JSON line per turn from stdin
// ({ id, audio: base64 Float32 at 16 kHz }) and writes { id, text } lines back.
/* eslint-disable @typescript-eslint/no-require-imports -- a plain CommonJS script run by node directly */
const { createRequire } = require("node:module");
const { join, resolve } = require("node:path");
const readline = require("node:readline");

const [cacheDir, modelDir] = process.argv.slice(2);
const sherpa = createRequire(resolve(cacheDir, "sherpa", "package.json"))("sherpa-onnx-node");
const recognizer = new sherpa.OfflineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    transducer: {
      encoder: join(modelDir, "encoder.int8.onnx"),
      decoder: join(modelDir, "decoder.int8.onnx"),
      joiner: join(modelDir, "joiner.int8.onnx"),
    },
    tokens: join(modelDir, "tokens.txt"),
    numThreads: 4,
    provider: "cpu",
    modelType: "nemo_transducer",
  },
});

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, audio } = JSON.parse(line);
  const bytes = Buffer.from(audio, "base64");
  const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate: 16000, samples: Float32Array.from(samples) });
  recognizer.decode(stream);
  process.stdout.write(JSON.stringify({ id, text: recognizer.getResult(stream).text.trim() }) + "\n");
});
process.stdout.write(JSON.stringify({ ready: true }) + "\n");
