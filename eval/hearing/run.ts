/**
 * Runs the hearing test set (see fetch.ts) through the app's hearing pipeline:
 * Silero VAD, the Segmenter, and Moonshine with the app's token limit and loop
 * guard. Each clip is heard in a quiet room and under real café and street
 * noise. Reports word error rate and how often a caption was cut off, split
 * into several lines, or missing.
 *
 *   npx tsx eval/hearing/run.ts [--split dev|test] [--model tiny|base|groq:<whisper model>|cf:nova-3]
 *     [--pad 96] [--silence 600] [--enter 0.3] [--exit 0.1]
 *     [--tokens app|library] [--limit N] [--label name]
 */
import { setDefaultResultOrder } from "node:dns";
import { AutoModel, pipeline, Tensor } from "@huggingface/transformers";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { FRAME, Framer, maxTranscriptTokens, SAMPLE_RATE } from "@/lib/hearing/audio";
import { DEFAULT_SEGMENTER, Segmenter } from "@/lib/hearing/segmenter";
import { trimRepeatedTail } from "@/lib/hearing/transcript";
import { CACHE, type Clip } from "./clips";
import { scoreClip, summarize, type ClipScore, type Summary } from "./score";
import { encodeWav, noiseGain, parseWav } from "./wav";

// This network drops some IPv6 connections to the APIs mid-request.
setDefaultResultOrder("ipv4first");

const { values: args } = parseArgs({
  options: {
    split: { type: "string", default: "dev" },
    model: { type: "string", default: "tiny" },
    pad: { type: "string", default: String(DEFAULT_SEGMENTER.padMs) },
    silence: { type: "string", default: String(DEFAULT_SEGMENTER.endSilenceMs) },
    enter: { type: "string", default: String(DEFAULT_SEGMENTER.speechThreshold) },
    exit: { type: "string", default: String(DEFAULT_SEGMENTER.exitThreshold) },
    tokens: { type: "string", default: "app" },
    limit: { type: "string" },
    label: { type: "string" },
  },
});

interface Condition {
  name: string;
  noise: string;
  snrDb: number;
}

const CONDITIONS: Condition[] = [
  // A quiet room still has some noise; digital silence never happens with a real microphone.
  { name: "quiet", noise: "PCAFETER", snrDb: 30 },
  { name: "cafe 10 dB", noise: "PCAFETER", snrDb: 10 },
  { name: "street 5 dB", noise: "STRAFFIC", snrDb: 5 },
];
const LEAD_S = 1;
const TAIL_S = 1.5;

type Vad = (i: Record<string, Tensor>) => Promise<{ output: Tensor; stateN: Tensor }>;
type Asr = (a: Float32Array, o?: { max_new_tokens?: number }) => Promise<{ text: string }>;

/** 16 kHz with a low-pass first, so 48 kHz Common Voice audio doesn't alias. */
function to16k(samples: Float32Array, rate: number): Float32Array {
  if (rate === SAMPLE_RATE) return samples;
  const ratio = rate / SAMPLE_RATE;
  const cutoff = 0.45 / ratio;
  const taps = 63;
  const half = (taps - 1) / 2;
  const kernel = Array.from({ length: taps }, (_, i) => {
    const x = i - half;
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    return sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1)));
  });
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let o = 0; o < out.length; o++) {
    const center = Math.round(o * ratio);
    let acc = 0;
    for (let k = 0; k < taps; k++) {
      const i = center + k - half;
      if (i >= 0 && i < samples.length) acc += samples[i] * kernel[k];
    }
    out[o] = acc;
  }
  return out;
}

function seeded(id: string): number {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends a request until it succeeds, waiting out rate limits and dropped
 * connections. `ms` is how long the successful request took, not the waits.
 */
async function send(name: string, request: () => Promise<Response>): Promise<{ res: Response; ms: number }> {
  for (let attempt = 0; ; attempt++) {
    const started = performance.now();
    let res: Response;
    try {
      res = await request();
    } catch (err) {
      if (attempt >= 6) throw err;
      console.error(`${name} request failed (${(err as Error & { cause?: Error }).cause?.message ?? String(err)}), retrying`);
      await sleep(3000 * 2 ** attempt);
      continue;
    }
    if (res.ok) return { res, ms: performance.now() - started };
    if (attempt >= 6 || (res.status !== 429 && res.status < 500)) throw new Error(`${name} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const asked = Number(res.headers.get("retry-after"));
    await sleep(asked > 0 ? asked * 1000 : 5000 * 2 ** attempt);
  }
}

/** One segment through Whisper on Groq. */
async function transcribeWithGroq(model: string, audio: Float32Array): Promise<{ text: string; ms: number }> {
  const wav = encodeWav(audio, SAMPLE_RATE);
  const { res, ms } = await send("Groq", () => {
    const form = new FormData();
    form.append("file", new Blob([wav as BlobPart], { type: "audio/wav" }), "turn.wav");
    form.append("model", model);
    form.append("language", "en");
    form.append("temperature", "0");
    form.append("response_format", "json");
    return fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: form,
    });
  });
  return { text: ((await res.json()) as { text: string }).text.trim(), ms };
}

/** One segment through Deepgram Nova-3 on Cloudflare Workers AI. */
async function transcribeWithNova(audio: Float32Array): Promise<{ text: string; ms: number }> {
  const wav = encodeWav(audio, SAMPLE_RATE);
  const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/deepgram/nova-3?smart_format=true&language=en`;
  const { res, ms } = await send("Cloudflare", () =>
    fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "audio/wav" },
      body: wav as BodyInit,
    }),
  );
  const body = (await res.json()) as { result: { results: { channels: { alternatives: { transcript: string }[] }[] } } };
  return { text: body.result.results.channels[0]?.alternatives[0]?.transcript.trim() ?? "", ms };
}

async function main() {
  const split = args.split as "dev" | "test";
  const clips = (JSON.parse(readFileSync(join(CACHE, "clips.json"), "utf8")) as Clip[])
    .filter((c) => c.split === split)
    .slice(0, args.limit ? Number(args.limit) : undefined);
  const noises = new Map<string, Float32Array>();
  for (const n of new Set(CONDITIONS.map((c) => c.noise))) {
    const { samples, sampleRate } = parseWav(readFileSync(join(CACHE, "noise", `${n}.wav`)));
    const all = to16k(samples, sampleRate);
    // Dev and test hear different halves of each recording.
    const half = Math.floor(all.length / 2);
    noises.set(n, split === "dev" ? all.subarray(0, half) : all.subarray(half));
  }

  const vad = (await AutoModel.from_pretrained("onnx-community/silero-vad", {
    config: { model_type: "custom" },
    dtype: "fp32",
  } as never)) as unknown as Vad;
  let transcribe: (audio: Float32Array) => Promise<{ text: string; ms: number }>;
  if (args.model.startsWith("groq:")) {
    const model = args.model.slice("groq:".length);
    process.loadEnvFile(".env.local");
    if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is missing. Add it to .env.local.");
    transcribe = (audio) => transcribeWithGroq(model, audio);
  } else if (args.model === "cf:nova-3") {
    process.loadEnvFile(".env.local");
    if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) throw new Error("Cloudflare keys are missing. Add them to .env.local.");
    transcribe = transcribeWithNova;
  } else {
    const asr = (await pipeline("automatic-speech-recognition", `onnx-community/moonshine-${args.model}-ONNX`, {
      dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
    } as never)) as unknown as Asr;
    transcribe = async (audio) => {
      const started = performance.now();
      const out = args.tokens === "app" ? await asr(audio, { max_new_tokens: maxTranscriptTokens(audio.length) }) : await asr(audio);
      return { text: trimRepeatedTail(out.text.trim()), ms: performance.now() - started };
    };
  }
  const options = {
    ...DEFAULT_SEGMENTER,
    padMs: Number(args.pad),
    endSilenceMs: Number(args.silence),
    speechThreshold: Number(args.enter),
    exitThreshold: Number(args.exit),
  };
  const sr = new Tensor("int64", BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);

  const results: {
    clip: Clip;
    condition: string;
    turns: string[];
    score: ClipScore;
    asrMs: number;
    diag: { start: number; end: number; discard: number; open: boolean; leadProb: number; tailProb: number };
  }[] = [];
  const started = Date.now();
  for (const [n, clip] of clips.entries()) {
    const { samples, sampleRate } = parseWav(readFileSync(clip.file));
    const speech = to16k(samples, sampleRate);
    const stream = new Float32Array(Math.round((LEAD_S + TAIL_S) * SAMPLE_RATE) + speech.length);
    stream.set(speech, LEAD_S * SAMPLE_RATE);
    for (const cond of CONDITIONS) {
      // Noise under the whole stream, levelled against the speech alone.
      const noise = noises.get(cond.noise)!;
      const offset = Math.floor(seeded(clip.id + cond.name) * noise.length);
      const gain = noiseGain(speech, noise, cond.snrDb, offset);
      const heard = stream.map((s, i) => s + noise[(offset + i) % noise.length] * gain);

      const segmenter = new Segmenter(options);
      const framer = new Framer();
      const frames: Float32Array[] = [];
      framer.push(heard, (f) => frames.push(f));
      let state = new Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
      const turns: string[] = [];
      const events = { start: 0, end: 0, discard: 0 };
      const probs: number[] = [];
      let asrMs = 0;
      for (const frame of frames) {
        const { output, stateN } = await vad({ input: new Tensor("float32", frame, [1, FRAME]), sr, state });
        state = stateN;
        const p = (output.data as Float32Array)[0];
        probs.push(p);
        for (const e of segmenter.push(frame, p)) {
          if (e.type === "start" || e.type === "discard") events[e.type]++;
          if (e.type !== "end") continue;
          events.end++;
          const { text, ms } = await transcribe(e.audio);
          asrMs += ms;
          if (text) turns.push(text);
        }
      }
      // Speech probability while only noise plays, before and after the speech.
      const leadFrames = Math.floor((LEAD_S * SAMPLE_RATE) / FRAME);
      const tailFrames = Math.floor((TAIL_S * SAMPLE_RATE) / FRAME);
      const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
      const diag = {
        ...events,
        /** Still inside a turn when the audio ran out: in the app, the caption would wait for a pause. */
        open: events.start > events.end + events.discard,
        leadProb: mean(probs.slice(0, leadFrames)),
        tailProb: mean(probs.slice(-tailFrames)),
      };
      results.push({ clip, condition: cond.name, turns, score: scoreClip(clip.text, turns), asrMs, diag });
    }
    if ((n + 1) % 20 === 0) console.error(`${n + 1}/${clips.length} clips (${Math.round((Date.now() - started) / 1000)} s)`);
  }

  const label = args.label ?? `${split}-${args.model.replace(":", "-")}-in${args.enter}-out${args.exit}-sil${args.silence}-${args.tokens}`;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const row = (name: string, s: Summary) =>
    `| ${name} | ${s.clips} | ${pct(s.wer)} | ${pct(s.exact)} | ${pct(s.cutOff)} | ${pct(s.split)} | ${pct(s.missed)} |`;
  const lines = [
    `## Hearing eval: ${label}`,
    "",
    "| Set | Clips | Word errors | Exact | Cut off | Split | Missed |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const source of ["ami", "cv"]) {
    for (const cond of CONDITIONS) {
      const s = results.filter((r) => r.clip.source === source && r.condition === cond.name).map((r) => r.score);
      if (s.length) lines.push(row(`${source}, ${cond.name}`, summarize(s)));
    }
  }
  lines.push(row("**all**", summarize(results.map((r) => r.score))));
  const times = results.map((r) => r.asrMs).sort((a, b) => a - b);
  lines.push("", `Transcription time per clip: median ${Math.round(times[Math.floor(times.length / 2)])} ms (local models: Node on this CPU; cloud: request round trip).`);
  const worst = results.filter((r) => r.score.cutOff || r.score.split).slice(0, 12);
  if (worst.length) {
    lines.push("", "Cut off or split (first 12):", "");
    for (const r of worst) lines.push(`- ${r.clip.id} (${r.condition}): "${r.clip.text}" -> ${r.turns.map((t) => `"${t}"`).join(" + ") || "(nothing)"}`);
  }
  const report = lines.join("\n");
  console.log(report);
  mkdirSync("eval/results", { recursive: true });
  writeFileSync(join(import.meta.dirname, "..", "results", `hearing-${label}.json`), JSON.stringify({ label, results }, null, 1));
  writeFileSync(join(import.meta.dirname, "..", "results", `hearing-${label}.md`), report + "\n");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
