/** Hesitation sounds. Transcripts write them inconsistently and they carry no meaning for replies. */
const FILLERS = new Set(["um", "umm", "uh", "uhh", "er", "erm", "ah", "hmm", "mm", "mhm", "mmhmm", "uhhuh"]);

export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\b(mm|uh)-(hmm|huh)\b/g, "$1$2")
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w && !FILLERS.has(w));
}

/** Word-level edit distance: substitutions + deletions + insertions. */
export function wordErrors(ref: string[], hyp: string[]): number {
  let prev = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const row = [i];
    for (let j = 1; j <= hyp.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[hyp.length];
}

export interface ClipScore {
  refWords: number;
  errors: number;
  /** The caption has under half as many words as were said. */
  cutOff: boolean;
  /** One sentence came out as more than one caption line. */
  split: boolean;
  /** No caption at all. */
  missed: boolean;
}

export function scoreClip(reference: string, turns: string[]): ClipScore {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(turns.join(" "));
  return {
    refWords: ref.length,
    errors: wordErrors(ref, hyp),
    cutOff: hyp.length < ref.length / 2,
    split: turns.filter((t) => t.trim()).length > 1,
    missed: turns.every((t) => !t.trim()),
  };
}

export interface Summary {
  clips: number;
  /** Word error rate pooled over every reference word. */
  wer: number;
  /** Share of clips with no word errors. */
  exact: number;
  cutOff: number;
  split: number;
  missed: number;
}

export function summarize(clips: ClipScore[]): Summary {
  const n = clips.length || 1;
  const words = clips.reduce((s, c) => s + c.refWords, 0) || 1;
  const share = (f: (c: ClipScore) => boolean) => clips.filter(f).length / n;
  return {
    clips: clips.length,
    wer: clips.reduce((s, c) => s + c.errors, 0) / words,
    exact: share((c) => c.errors === 0),
    cutOff: share((c) => c.cutOff),
    split: share((c) => c.split),
    missed: share((c) => c.missed),
  };
}
