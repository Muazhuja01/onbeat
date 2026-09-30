import type { ExpectedChange } from "./cases";
import type { AssistVerdict, ShownCard } from "./judge";

export interface AssistCaseResult {
  id: string;
  model: string;
  expected: ExpectedChange[];
  cards: (ShownCard & { noteId?: string })[];
  userMessages: number;
  verdict: AssistVerdict | null;
  error?: string;
}
export interface AssistSummary {
  cases: number;
  void: number;
  shown: number;
  keep: [number, number];
  invented: [number, number];
  editsRight: [number, number];
  recall: [number, number];
  sayable: [number, number];
  medianUserMessages: number;
}

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Scoring rules:
 * - A case whose verdict says the simulated user leaked a fact outside its brief is void:
 *   counted in `void` and left out of every other number. A case with an error or no
 *   verdict is left out too (the runner reports it).
 * - shown: all cards in counted cases. keep: cards judged worth keeping. invented: cards
 *   with any invented detail. sayable: of phrase cards, those judged sayable.
 * - editsRight: of expected edits and removals, those matched (by the judge's `matches`)
 *   by a card with the same action on the same note.
 * - recall: expected changes matched by any kept card.
 * - medianUserMessages: median user messages over counted cases that expected a change.
 */
export function summarizeAssist(results: AssistCaseResult[]): AssistSummary {
  const judged = results.filter((r) => !r.error && r.verdict);
  const counted = judged.filter((r) => !r.verdict!.leak);
  const s: AssistSummary = { cases: counted.length, void: judged.length - counted.length, shown: 0, keep: [0, 0], invented: [0, 0], editsRight: [0, 0], recall: [0, 0], sayable: [0, 0], medianUserMessages: 0 };
  for (const r of counted) {
    const v = r.verdict!.cards;
    s.shown += r.cards.length;
    s.keep = [s.keep[0] + v.filter((c) => c.keep).length, s.keep[1] + r.cards.length];
    s.invented = [s.invented[0] + v.filter((c) => c.invented.length > 0).length, s.invented[1] + r.cards.length];
    r.cards.forEach((card, i) => {
      if (card.action === "phrase" && v[i].sayable !== null) s.sayable = [s.sayable[0] + (v[i].sayable ? 1 : 0), s.sayable[1] + 1];
    });
    r.expected.forEach((e, i) => {
      const n = i + 1;
      const matched = r.cards.map((c, j) => ({ c, v: v[j] })).filter((x) => x.v.matches === n);
      if (e.action === "edit" || e.action === "remove") {
        const right = matched.some((x) => x.c.action === e.action && x.c.noteId === e.noteId);
        s.editsRight = [s.editsRight[0] + (right ? 1 : 0), s.editsRight[1] + 1];
      }
      s.recall = [s.recall[0] + (matched.some((x) => x.v.keep) ? 1 : 0), s.recall[1] + 1];
    });
  }
  s.medianUserMessages = median(counted.filter((r) => r.expected.length > 0).map((r) => r.userMessages));
  return s;
}

const pct = ([a, b]: [number, number]) => (b ? `${Math.round((100 * a) / b)}% (${a}/${b})` : "n/a");

export function assistMarkdown(split: string, votes: number, rows: { model: string; summary: AssistSummary }[]): string {
  return [
    `${split} split, ${votes} judge vote(s)`,
    "",
    "| Model | Cases (void) | Shown | Worth keeping (target 90%) | Invented (target under 5%) | Edits right (target 90%) | Recall (target 80%) | Phrases sayable (target 80%) | Median user messages (target 5 or fewer) |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows.map(({ model, summary: s }) => `| ${model} | ${s.cases} (${s.void}) | ${s.shown} | ${pct(s.keep)} | ${pct(s.invented)} | ${pct(s.editsRight)} | ${pct(s.recall)} | ${pct(s.sayable)} | ${s.medianUserMessages} |`),
    "",
  ].join("\n");
}
