/** Where spoken lines come from: Chatterbox waking up, Chatterbox ready, or Chatterbox unavailable (the backup speaks). */
export type VoiceSource = "waking" | "awake" | "down";

export type VoiceWorkerRequest =
  | { type: "load" }
  | { type: "generate"; id: number; text: string; voice: string; speed: number; urgent?: boolean }
  /** A line sent earlier as prepared is now the line being said. Only the router acts on it. */
  | { type: "urgent"; id: number };

export type VoiceWorkerMessage =
  | { type: "ready" }
  | { type: "progress"; value: number }
  /**
   * A line's clip. A long line comes in pieces as they are made: `part` says which of the line's parts
   * (from `splitLine`) this piece covers, `from` up to but not including `to`, out of `of`. A piece
   * may cover several parts, such as the rest of a line made by the backup voice. No `part`: the whole line.
   */
  | { type: "audio"; id: number; samples: Float32Array; sampleRate: number; backup?: boolean; part?: { from: number; to: number; of: number } }
  | { type: "error"; id?: number; message: string }
  | { type: "source"; source: VoiceSource };
