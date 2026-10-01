import { en } from "@/lib/language-packs/en";
import { DEFAULT_VOICE, speedValue, voiceId, type VoiceChoice } from "./choices";
import { VoiceEngine, type AudioOut, type BasicSpeech } from "./engine";
import { SpeakError, VoiceRouter } from "./router";

export function webAudioOut(): AudioOut {
  let ctx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let finishCurrent: (() => void) | null = null;
  return {
    play(samples, sampleRate) {
      ctx ??= new AudioContext();
      void ctx.resume();
      this.stop();
      const buffer = ctx.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      source = node;
      return new Promise<void>((resolve) => {
        finishCurrent = resolve;
        node.onended = () => {
          if (source === node) source = null;
          resolve();
        };
        node.start();
      });
    },
    stop() {
      if (source) {
        const node = source;
        source = null;
        try {
          node.stop();
        } catch {
          // already stopped
        }
      }
      finishCurrent?.();
      finishCurrent = null;
    },
  };
}

export function browserBasicSpeech(lang = en.bcp47): BasicSpeech {
  return {
    speak(text, rate) {
      return new Promise<void>((resolve) => {
        if (typeof speechSynthesis === "undefined") {
          resolve();
          return;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        utterance.rate = rate;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        speechSynthesis.speak(utterance);
      });
    },
    stop() {
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    },
  };
}


/** The open profile's or demo's voice; the conversation screen sets it. */
let current = { voice: voiceId(DEFAULT_VOICE), speed: speedValue(DEFAULT_VOICE) };

export function setCurrentVoice(choice: VoiceChoice): void {
  current = { voice: voiceId(choice), speed: speedValue(choice) };
}

/** One line from the voice server, through OnBeat's own route. */
export async function speakViaServer(req: { text: string; voice: string; speed: number }, signal: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch("/api/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req), signal });
  if (!res.ok) throw new SpeakError(res.status);
  return res.arrayBuffer();
}

/** Starts the voice server; true once it answers that it's ready. */
export async function warmServer(): Promise<boolean> {
  try {
    return (await fetch("/api/speak?warm=1", { method: "POST" })).ok;
  } catch {
    return false;
  }
}

let engine: VoiceEngine | null = null;

export function getBrowserVoice(): VoiceEngine {
  if (engine) return engine;
  const kokoro =
    typeof Worker === "undefined" ? null : new Worker(new URL("../../workers/voice.worker.ts", import.meta.url), { type: "module" });
  // The engine's load() sends the wake call, so the voice server starts when the app opens.
  const worker = new VoiceRouter({ kokoro, speak: speakViaServer, warm: warmServer });
  engine = new VoiceEngine({ worker, audio: webAudioOut(), basic: browserBasicSpeech(), voice: () => current.voice, speed: () => current.speed, parallel: 3 });
  return engine;
}
