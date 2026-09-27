import { en } from "@/lib/language-packs/en";
import { VoiceEngine, type AudioOut, type BasicSpeech } from "./engine";

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

function readVoice(): string {
  try {
    return localStorage.getItem("onbeat:voice") ?? en.defaultVoice;
  } catch {
    return en.defaultVoice;
  }
}

let engine: VoiceEngine | null = null;

export function getBrowserVoice(): VoiceEngine {
  if (engine) return engine;
  const worker =
    typeof Worker === "undefined" ? null : new Worker(new URL("../../workers/voice.worker.ts", import.meta.url), { type: "module" });
  engine = new VoiceEngine({ worker, audio: webAudioOut(), basic: browserBasicSpeech(), voice: readVoice, speed: () => 1 });
  return engine;
}
