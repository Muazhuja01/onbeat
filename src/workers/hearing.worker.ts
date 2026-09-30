import { AutoModel, env, pipeline, Tensor } from "@huggingface/transformers";
import { Framer, maxTranscriptTokens, SAMPLE_RATE } from "@/lib/hearing/audio";
import type { HearingWorkerMessage, HearingWorkerRequest } from "@/lib/hearing/messages";
import { Segmenter, type SegmentEvent } from "@/lib/hearing/segmenter";
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

function post(message: HearingWorkerMessage): void {
  (self as unknown as Worker).postMessage(message);
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
const framer = new Framer();
const segmenter = new Segmenter();
/** Inference runs one call at a time, in arrival order. */
let chain: Promise<void> = Promise.resolve();
/** Bumped by "reset", so work queued before it is dropped. */
let generation = 0;
/** A partial transcript is queued or running; newer ones are skipped until it is done. */
let partialBusy = false;
/** VAD and partial failures log once per generation, not once per frame; reset on "reset". */
let loggedError = false;

function enqueue(task: () => Promise<void>): void {
  chain = chain.then(task).catch((err) => console.error("hearing worker:", err));
}

async function transcribe(audio: Float32Array): Promise<{ text: string; ms: number }> {
  const { asr } = await models!;
  const started = performance.now();
  const out = await asr(audio, { max_new_tokens: maxTranscriptTokens(audio.length) });
  const text = trimRepeatedTail((Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).trim());
  return { text, ms: Math.round(performance.now() - started) };
}

function logOnce(context: string, err: unknown): void {
  if (loggedError) return;
  loggedError = true;
  console.error(`hearing worker (${context}):`, err);
}

function handle(events: SegmentEvent[], at: number, gen: number): void {
  for (const e of events) {
    if (e.type === "start") {
      // Posted through the chain too, so it can't arrive after a still-pending turnEnd.
      enqueue(async () => {
        if (gen === generation) post({ type: "speechStart" });
      });
    } else if (e.type === "partial") {
      if (partialBusy) continue;
      partialBusy = true;
      enqueue(async () => {
        try {
          if (gen !== generation) return;
          const { text, ms } = await transcribe(e.audio);
          if (gen === generation && text) post({ type: "partial", text, ms });
        } catch (err) {
          logOnce("partial", err);
        } finally {
          if (gen === generation) partialBusy = false;
        }
      });
    } else if (e.type === "end") {
      const endedAt = at - e.silenceMs;
      enqueue(async () => {
        if (gen !== generation) return;
        try {
          const { text, ms } = await transcribe(e.audio);
          // Sent even when empty, so the page can clear a live caption.
          if (gen === generation) post({ type: "turnEnd", text, endedAt, ms });
        } catch (err) {
          console.error("hearing worker (turnEnd):", err);
          // Still resolve the turn, so the page never waits forever for it.
          if (gen === generation) post({ type: "turnEnd", text: "", endedAt, ms: 0 });
        }
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
      try {
        const { vad } = await models;
        const { output, stateN } = await vad({ input: new Tensor("float32", frame, [1, frame.length]), sr, state: vadState });
        if (gen !== generation) return;
        vadState = stateN;
        handle(segmenter.push(frame, (output.data as Float32Array)[0]), at, gen);
      } catch (err) {
        logOnce("vad", err);
      }
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
          resetProgress();
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
      loggedError = false;
      return;
    case "audio":
      onAudio(msg.samples);
  }
};
