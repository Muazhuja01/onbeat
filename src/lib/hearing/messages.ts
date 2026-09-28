export type HearingWorkerRequest =
  | { type: "load"; model: string }
  | { type: "audio"; samples: Float32Array }
  | { type: "reset" };

export type HearingWorkerMessage =
  | { type: "progress"; value: number }
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "speechStart" }
  /** Transcript of the partner's words so far; `ms` is how long transcription took. */
  | { type: "partial"; text: string; ms: number }
  /** The partner paused long enough to end the turn. `endedAt` is when their last word ended (ms since epoch). Text may be empty. */
  | { type: "turnEnd"; text: string; endedAt: number; ms: number };
