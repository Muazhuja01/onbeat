export type VoiceWorkerRequest =
  | { type: "load" }
  | { type: "generate"; id: number; text: string; voice: string; speed: number };

export type VoiceWorkerMessage =
  | { type: "ready" }
  | { type: "progress"; value: number }
  | { type: "audio"; id: number; samples: Float32Array; sampleRate: number }
  | { type: "error"; id?: number; message: string };
