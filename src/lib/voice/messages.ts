/** Where spoken lines come from: Chatterbox waking up, Chatterbox ready, or Chatterbox unavailable (the backup speaks). */
export type VoiceSource = "waking" | "awake" | "down";

export type VoiceWorkerRequest =
  | { type: "load" }
  | { type: "generate"; id: number; text: string; voice: string; speed: number; urgent?: boolean };

export type VoiceWorkerMessage =
  | { type: "ready" }
  | { type: "progress"; value: number }
  | { type: "audio"; id: number; samples: Float32Array; sampleRate: number; backup?: boolean }
  | { type: "error"; id?: number; message: string }
  | { type: "source"; source: VoiceSource };
