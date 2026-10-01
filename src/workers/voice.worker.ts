import { KokoroTTS } from "kokoro-js";
import type { VoiceWorkerMessage, VoiceWorkerRequest } from "@/lib/voice/messages";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
let tts: Promise<KokoroTTS> | null = null;

function post(message: VoiceWorkerMessage, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(message, transfer);
}

function load(): Promise<KokoroTTS> {
  // q8 on WebAssembly keeps the one-time download near 90 MB.
  tts ??= KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p) => {
      if (p.status === "progress") post({ type: "progress", value: Math.round(p.progress) });
    },
  });
  return tts;
}

self.onmessage = async (event: MessageEvent<VoiceWorkerRequest>) => {
  const msg = event.data;
  if (msg.type === "load") {
    try {
      await load();
      post({ type: "ready" });
    } catch (err) {
      tts = null;
      post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  // Anything else (such as "urgent", which only the router uses) is not ours.
  if (msg.type !== "generate") return;
  try {
    const model = await load();
    const audio = await model.generate(msg.text, { voice: msg.voice as "af_heart", speed: msg.speed });
    const samples = audio.audio as Float32Array;
    post({ type: "audio", id: msg.id, samples, sampleRate: audio.sampling_rate }, [samples.buffer as ArrayBuffer]);
  } catch (err) {
    post({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
