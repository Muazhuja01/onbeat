import { AutoModel, env, pipeline, Tensor } from "@huggingface/transformers";
import { Framer, SAMPLE_RATE } from "@/lib/hearing/audio";
import type { HearingWorkerMessage, HearingWorkerRequest } from "@/lib/hearing/messages";
import { Segmenter, type SegmentEvent } from "@/lib/hearing/segmenter";

env.allowLocalModels = false;

type Progress = { status: string; name?: string; file?: string; loaded?: number; total?: number };
type AsrOutput = { text: string } | { text: string }[];
type Transcriber = (audio: Float32Array) => Promise<AsrOutput>;
// pipeline()'s overloads are too complex for TypeScript here; narrow them (as embedder.worker.ts does).
type AsrFactory = (
  task: "automatic-speech-recognition",
  model: string,
  options: {
    device: "wasm";
    dtype: { encoder_model: "fp32"; decoder_model_merged: "q8" };
    progress_callback: (p: Progress) => void;
  },
) => Promise<Transcriber>;
const createTranscriber = pipeline as unknown as AsrFactory;

type Vad = (inputs: { input: Tensor; sr: Tensor; state: Tensor }) => Promise<{ output: Tensor; stateN: Tensor }>;
type ModelOptions = Parameters<typeof AutoModel.from_pretrained>[1];

const VAD_MODEL = "onnx-community/silero-vad";

let models: Promise<{ vad: Vad; asr: Transcriber }> | null = null;
const downloads = new Map<string, { loaded: number; total: number }>();
let shownPercent = -1;

function post(message: HearingWorkerMessage): void {
  (self as unknown as Worker).postMessage(message);
}

/** One overall percentage across all model files, never going backwards. */
function onProgress(p: Progress): void {
  if (p.status !== "progress" || !p.file || !p.total) return;
  downloads.set(`${p.name ?? ""}/${p.file}`, { loaded: p.loaded ?? 0, total: p.total });
  let loaded = 0;
  let total = 0;
  for (const d of downloads.values()) {
    loaded += d.loaded;
    total += d.total;
  }
  const percent = Math.floor((loaded / total) * 100);
  if (percent > shownPercent) {
    shownPercent = percent;
    post({ type: "progress", value: percent });
  }
}

async function loadModels(model: string): Promise<{ vad: Vad; asr: Transcriber }> {
  // Silero VAD is a custom ONNX model. The options are cast because `config`
  // is typed as a full PretrainedConfig; this is the Moonshine Web example's call.
  const vad = (await AutoModel.from_pretrained(VAD_MODEL, {
    config: { model_type: "custom" },
    dtype: "fp32",
    progress_callback: onProgress,
  } as unknown as ModelOptions)) as unknown as Vad;
  const asr = await createTranscriber("automatic-speech-recognition", model, {
    device: "wasm",
    dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
    progress_callback: onProgress,
  });
  await asr(new Float32Array(SAMPLE_RATE)); // warm up, so the first real transcript isn't slow
  return { vad, asr };
}

const sr = new Tensor("int64", BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
const freshState = () => new Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
let vadState = freshState();
const framer = new Framer();
const segmenter = new Segmenter();
/** Inference runs one call at a time, in arrival order. */
let chain: Promise<void> = Promise.resolve();
/** Bumped by "reset", so work queued before it is dropped. */
let generation = 0;
/** A partial transcript is queued or running; newer ones are skipped until it is done. */
let partialBusy = false;

function enqueue(task: () => Promise<void>): void {
  chain = chain.then(task).catch((err) => console.error("hearing worker:", err));
}

async function transcribe(audio: Float32Array): Promise<{ text: string; ms: number }> {
  const { asr } = await models!;
  const started = performance.now();
  const out = await asr(audio);
  const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).trim();
  return { text, ms: Math.round(performance.now() - started) };
}

function handle(events: SegmentEvent[], at: number, gen: number): void {
  for (const e of events) {
    if (e.type === "start") {
      post({ type: "speechStart" });
    } else if (e.type === "partial") {
      if (partialBusy) continue;
      partialBusy = true;
      enqueue(async () => {
        try {
          if (gen !== generation) return;
          const { text, ms } = await transcribe(e.audio);
          if (gen === generation && text) post({ type: "partial", text, ms });
        } finally {
          partialBusy = false;
        }
      });
    } else if (e.type === "end") {
      const endedAt = at - e.silenceMs;
      enqueue(async () => {
        if (gen !== generation) return;
        const { text, ms } = await transcribe(e.audio);
        // Sent even when empty, so the page can clear a live caption.
        if (gen === generation) post({ type: "turnEnd", text, endedAt, ms });
      });
    }
  }
}

function onAudio(samples: Float32Array): void {
  const at = Date.now();
  const gen = generation;
  framer.push(samples, (frame) =>
    enqueue(async () => {
      if (gen !== generation || !models) return;
      const { vad } = await models;
      const { output, stateN } = await vad({ input: new Tensor("float32", frame, [1, frame.length]), sr, state: vadState });
      if (gen !== generation) return;
      vadState = stateN;
      handle(segmenter.push(frame, (output.data as Float32Array)[0]), at, gen);
    }),
  );
}

self.onmessage = (event: MessageEvent<HearingWorkerRequest>) => {
  const msg = event.data;
  switch (msg.type) {
    case "load":
      models ??= loadModels(msg.model);
      models.then(
        () => post({ type: "ready" }),
        (err) => {
          models = null;
          post({ type: "error", message: err instanceof Error ? err.message : String(err) });
        },
      );
      return;
    case "reset":
      generation++;
      framer.reset();
      segmenter.reset();
      vadState = freshState();
      partialBusy = false;
      return;
    case "audio":
      onAudio(msg.samples);
  }
};
