import type { ExpectedChange } from "./cases";
import type { AssistVerdict, ShownCard } from "./judge";

export interface AssistCaseResult {
  id: string;
  model: string;
  expected: ExpectedChange[];
  cards: (ShownCard & { noteId?: string })[];
  userMessages: number;
  verdict: AssistVerdict | null;
  /** Per card, the case's brief-only terms it states that no user line has (see briefOnlyCards). */
  briefOnly?: string[][];
  error?: string;
}
export interface AssistSummary {
  cases: number;
  void: number;
  shown: number;
  keep: [number, number];
  invented: [number, number];
  /** Cards counted as invented only because of the brief-only check; the judge found nothing. */
  inventedByBriefCheck: number;
  editsRight: [number, number];
  recall: [number, number];
  sayable: [number, number];
  medianUserMessages: number;
}

/** Lowercase, with dashes as spaces and curly apostrophes straight, so "Parent‑teacher" reads as "parent teacher". */
const plain = (t: string) =>
  t
    .toLowerCase()
    .replace(/[‐-―-]/g, " ")
    .replace(/[‘’]/g, "'");

/** A term as a whole-word pattern: "check-up" also matches "checkup" and "check up", "limp*" matches "limping", and "key" matches "keys". */
function termPattern(term: string): RegExp {
  const prefix = term.endsWith("*");
  const words = plain(prefix ? term.slice(0, -1) : term)
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join("\\s*")}${prefix ? "" : "s?(?![\\p{L}\\p{N}])"}`, "u");
}

/** Whether a text states a term, as briefOnlyCards reads it. */
export const statesTerm = (text: string, term: string) => termPattern(term).test(plain(text));

/**
 * The mechanical half of "invented": per card, the brief-only terms (AssistCase.briefOnly) it
 * states, in its text or who a phrase is for, that no user line states. The assistant never
 * sees the brief, so such a detail can only be a guess.
 */
export function briefOnlyCards(cards: ShownCard[], terms: string[], lines: { speaker: "user" | "assistant"; text: string }[]): string[][] {
  const said = lines
    .filter((l) => l.speaker === "user")
    .map((l) => l.text)
    .join("\n");
  const open = terms.filter((t) => !statesTerm(said, t));
  return cards.map((card) => open.filter((t) => statesTerm(`${card.text}\n${card.forName ?? ""}`, t)));
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
 *   the judge found an invented detail in, or that state a brief-only term no user line has
 *   (`briefOnly`). sayable: of phrase cards, those judged sayable.
 * - editsRight: of expected edits and removals, those matched (by the judge's `matches`)
 *   by a card with the same action on the same note.
 * - recall: expected changes matched by any kept card.
 * - medianUserMessages: median user messages over counted cases that expected a change.
 */
export function summarizeAssist(results: AssistCaseResult[]): AssistSummary {
  const judged = results.filter((r) => !r.error && r.verdict);
  const counted = judged.filter((r) => !r.verdict!.leak);
  const s: AssistSummary = { cases: counted.length, void: judged.length - counted.length, shown: 0, keep: [0, 0], invented: [0, 0], inventedByBriefCheck: 0, editsRight: [0, 0], recall: [0, 0], sayable: [0, 0], medianUserMessages: 0 };
  for (const r of counted) {
    const v = r.verdict!.cards;
    s.shown += r.cards.length;
    s.keep = [s.keep[0] + v.filter((c) => c.keep).length, s.keep[1] + r.cards.length];
    const byCheck = (i: number) => (r.briefOnly?.[i]?.length ?? 0) > 0;
    s.invented = [s.invented[0] + v.filter((c, i) => c.invented.length > 0 || byCheck(i)).length, s.invented[1] + r.cards.length];
    s.inventedByBriefCheck += v.filter((c, i) => c.invented.length === 0 && byCheck(i)).length;
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
    ...rows.filter(({ summary: s }) => s.inventedByBriefCheck > 0).map(({ model, summary: s }) => `${model}: invented includes ${s.inventedByBriefCheck} card(s) flagged only by the brief-only check.`),
  ].join("\n");
}
