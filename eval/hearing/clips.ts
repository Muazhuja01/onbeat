/** Where fetch.ts saves the hearing test set (git-ignored). Paths are relative to the repo root. */
export const CACHE = "eval/hearing/.cache";
export type Split = "dev" | "test";

export interface Clip {
  id: string;
  source: "ami" | "cv";
  split: Split;
  text: string;
  speaker: string;
  file: string;
}
