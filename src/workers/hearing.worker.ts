import { AutoModel, env, pipeline, Tensor } from "@huggingface/transformers";
import { Framer, maxTranscriptTokens, SAMPLE_RATE } from "@/lib/hearing/audio";
import type { HearingWorkerMessage, HearingWorkerRequest } from "@/lib/hearing/messages";
import { LiveTranscriber } from "@/lib/hearing/live-transcriber";
import { trimRepeatedTail } from "@/lib/hearing/transcript";

env.allowLocalModels = false;

type Progress = { status: string; name?: string; file?: string; loaded?: number; total?: number };
type AsrOutput = { text: string } | { text: string }[];
type Transcriber = (audio: Float32Array, options?: { max_new_tokens?: number }) => Promise<AsrOutput>;
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

// The VAD is tiny next to the speech model; weight the combined percentage
// so most of the bar reflects the (much larger) speech model's download.
type Stage = "vad" | "asr";
const STAGE_WEIGHT: Record<Stage, number> = { vad: 5, asr: 95 };
const stageFiles: Record<Stage, Map<string, { loaded: number; total: number }>> = {
  vad: new Map(),
  asr: new Map(),
};
let shownPercent = -1;

function post(message: HearingWorkerMessage, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(message, transfer);
}

function fractionOf(stage: Stage): number {
  let loaded = 0;
  let total = 0;
  for (const d of stageFiles[stage].values()) {
    loaded += d.loaded;
    total += d.total;
  }
  return total > 0 ? loaded / total : 0;
}

/** Combined percentage across both stages, never going backwards, held below 100 until "ready". */
function reportProgress(): void {
  const overall = STAGE_WEIGHT.vad * fractionOf("vad") + STAGE_WEIGHT.asr * fractionOf("asr");
  const percent = Math.min(99, Math.floor(overall));
  if (percent > shownPercent) {
    shownPercent = percent;
    post({ type: "progress", value: percent });
  }
}

/** So a retry after a failed load reports progress from zero again. */
function resetProgress(): void {
  stageFiles.vad.clear();
  stageFiles.asr.clear();
  shownPercent = -1;
}

function progressFor(stage: Stage): (p: Progress) => void {
  return (p) => {
    if (p.status !== "progress" || !p.file || !p.total) return;
    stageFiles[stage].set(p.file, { loaded: p.loaded ?? 0, total: p.total });
    reportProgress();
  };
}

async function loadModels(model: string): Promise<{ vad: Vad; asr: Transcriber }> {
  // Silero VAD is a custom ONNX model. The options are cast because `config`
  // is typed as a full PretrainedConfig; this is the Moonshine Web example's call.
  const vad = (await AutoModel.from_pretrained(VAD_MODEL, {
    config: { model_type: "custom" },
    dtype: "fp32",
    progress_callback: progressFor("vad"),
  } as unknown as ModelOptions)) as unknown as Vad;
  const asr = await createTranscriber("automatic-speech-recognition", model, {
    device: "wasm",
    dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
    progress_callback: progressFor("asr"),
  });
  await asr(new Float32Array(SAMPLE_RATE)); // warm up, so the first real transcript isn't slow
  return { vad, asr };
}

const sr = new Tensor("int64", BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
const freshState = () => new Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
let vadState = freshState();
/** Bumped by "reset", so a VAD call already running doesn't bring back the old state. */
let vadGeneration = 0;
const framer = new Framer();
/** VAD and read failures log once per reset, not once per frame. */
let loggedError = false;

async function transcribe(audio: Float32Array): Promise<{ text: string; ms: number }> {
  const { asr } = await models!;
  const started = performance.now();
  const out = await asr(audio, { max_new_tokens: maxTranscriptTokens(audio.length) });
  const text = trimRepeatedTail((Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).trim());
  return { text, ms: Math.round(performance.now() - started) };
}

const live = new LiveTranscriber({
  vad: async (frame) => {
    const { vad } = await models!;
    const gen = vadGeneration;
    const { output, stateN } = await vad({ input: new Tensor("float32", frame, [1, frame.length]), sr, state: vadState });
    if (gen === vadGeneration) vadState = stateN;
    return (output.data as Float32Array)[0];
  },
  transcribe,
  post,
  onError: (context, err) => {
    if (context === "turnEnd") {
      console.error("hearing worker (turnEnd):", err);
      return;
    }
    if (loggedError) return;
    loggedError = true;
    console.error(`hearing worker (${context}):`, err);
  },
});

function onAudio(samples: Float32Array): void {
  if (!models) return;
  const at = Date.now();
  // The framer reuses nothing it hands out, so each frame can be kept.
  framer.push(samples, (frame) => live.push(frame, at));
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
          resetProgress();
          post({ type: "error", message: err instanceof Error ? err.message : String(err) });
        },
      );
      return;
    case "reset":
      live.reset();
      framer.reset();
      vadGeneration++;
      vadState = freshState();
      loggedError = false;
      return;
    case "audio":
      onAudio(msg.samples);
  }
};
