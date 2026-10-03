const norm = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/**
 * Speech models decoding greedily can get stuck repeating a phrase until they
 * hit their token limit ("can I have your name written on it can I have your
 * name written on it can I have your"). When the end of a transcript is one
 * phrase over and over, keep a single copy. Short repeats people really say
 * ("no, no", "thank you, thank you") are left alone.
 */
export function trimRepeatedTail(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const n = words.length;
  const keys = words.map(norm);
  let best: { start: number; period: number } | null = null;
  for (let period = 1; period * 2 <= n; period++) {
    // Walk back from the end while each word matches the one a period earlier.
    let j = n - 1;
    while (j - period >= 0 && keys[j] === keys[j - period]) j--;
    // Words from `start` on are one phrase repeated; `repeated` counts those after its first copy.
    const start = j + 1 - period;
    const repeated = n - (j + 1);
    if (start < 0 || repeated < Math.max(period, 4)) continue;
    if (!best || start < best.start) best = { start, period };
  }
  return best ? words.slice(0, best.start + best.period).join(" ") : text;
}

const I_WORDS = new Set(["i", "i'm", "i'll", "i've", "i'd"]);

/**
 * Joins the transcripts of a turn's pieces. The speech model ends each piece as a sentence, so
 * after a cut made mid-flow (`forced`, no pause) the full stop is dropped, the next word loses
 * its capital (except "I"), and a word heard on both sides of the cut is kept once.
 */
export function joinPieces(pieces: { text: string; forced: boolean }[]): string {
  const words: string[] = [];
  let smooth = false;
  for (const piece of pieces) {
    const next = piece.text.split(/\s+/).filter(Boolean);
    if (!next.length) continue;
    if (smooth && words.length) {
      if (norm(words[words.length - 1]) === norm(next[0])) words.pop();
      else words[words.length - 1] = words[words.length - 1].replace(/\.$/, "");
      if (!I_WORDS.has(norm(next[0]))) next[0] = next[0].charAt(0).toLowerCase() + next[0].slice(1);
    }
    words.push(...next);
    smooth = piece.forced && !/[?!]$/.test(next[next.length - 1]);
  }
  return words.join(" ");
}
