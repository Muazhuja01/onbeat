/** Hesitation sounds. Transcripts write them inconsistently and they carry no meaning for replies. */
const FILLERS = new Set(["um", "umm", "uh", "uhh", "er", "erm", "ah", "hmm", "mm", "mhm", "mmhmm", "uhhuh"]);

// The rules below follow Whisper's English text normalizer, so word error rates
// here compare with published ones: "you've" matches "you have", "ninety nine"
// matches "99", "colour" matches "color".
const CONTRACTIONS: [RegExp, string][] = [
  [/\bwon't\b/g, "will not"],
  [/\bcan't\b/g, "can not"],
  [/\bain't\b/g, "is not"],
  [/n't\b/g, " not"],
  [/'re\b/g, " are"],
  [/'ve\b/g, " have"],
  [/'ll\b/g, " will"],
  [/'m\b/g, " am"],
  [/'d\b/g, " would"],
];

const BRITISH: Record<string, string> = {
  colour: "color",
  favourite: "favorite",
  flavour: "flavor",
  behaviour: "behavior",
  neighbour: "neighbor",
  honour: "honor",
  labour: "labor",
  humour: "humor",
  programme: "program",
  centre: "center",
  theatre: "theater",
  metre: "meter",
  litre: "liter",
  licence: "license",
  defence: "defense",
  grey: "gray",
  realise: "realize",
  realised: "realized",
  organise: "organize",
  organised: "organized",
  recognise: "recognize",
  apologise: "apologize",
  travelling: "traveling",
  cancelled: "canceled",
  ok: "okay",
};

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const TENS_PLURAL = TENS.map((t) => (t ? t.replace(/y$/, "ies") : ""));

function numberValue(word: string): { kind: "unit" | "ten" | "hundred" | "thousand"; value: number } | null {
  if (UNITS.includes(word)) return { kind: "unit", value: UNITS.indexOf(word) };
  if (TENS.includes(word) && word) return { kind: "ten", value: TENS.indexOf(word) * 10 };
  if (word === "hundred") return { kind: "hundred", value: 100 };
  if (word === "thousand") return { kind: "thousand", value: 1000 };
  return null;
}

/** Runs of number words become digits: "two hundred and five" -> "205", "nineties" -> "90s". */
function digits(words: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; ) {
    const plural = TENS_PLURAL.indexOf(words[i]);
    if (plural > 1) {
      out.push(`${plural * 10}s`);
      i++;
      continue;
    }
    if (!numberValue(words[i])) {
      out.push(words[i++]);
      continue;
    }
    let total = 0;
    let current = 0;
    let last: string | null = null;
    while (i < words.length) {
      const w = words[i];
      // "and" only joins a number when it comes after hundred or thousand: "two hundred and five".
      if (w === "and" && (last === "hundred" || last === "thousand") && numberValue(words[i + 1] ?? "")) {
        i++;
        continue;
      }
      const n = numberValue(w);
      if (!n) break;
      // A second unit or ten starts a new number ("twenty twenty" is two numbers, not forty).
      if (n.kind === "unit" && last !== null && current % 100 !== 0 && (current % 10 !== 0 || current % 100 < 20)) break;
      if (n.kind === "ten" && current % 100 !== 0) break;
      if (n.kind === "unit" || n.kind === "ten") current += n.value;
      else if (n.kind === "hundred") current = (current || 1) * 100;
      else {
        total += (current || 1) * 1000;
        current = 0;
      }
      last = n.kind;
      i++;
    }
    out.push(String(total + current));
  }
  return out;
}

export function normalizeWords(text: string): string[] {
  let t = text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\b(mm|uh)-(hmm|huh)\b/g, "$1$2");
  for (const [pattern, full] of CONTRACTIONS) t = t.replace(pattern, full);
  const words = t
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w && !FILLERS.has(w))
    .map((w) => BRITISH[w] ?? (w.endsWith("s") && BRITISH[w.slice(0, -1)] ? `${BRITISH[w.slice(0, -1)]}s` : w));
  return digits(words);
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
