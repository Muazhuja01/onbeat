import { percentile } from "@/lib/stats";

export interface Judgement {
  /** 1-based number of the first shown reply that says what the user meant; 0 if none. */
  match: number;
  /** 1-based numbers of shown replies that state a fact the sources don't back up. */
  invented: number[];
}

export interface ScenarioResult {
  id: string;
  /** False when the model request failed. */
  ok: boolean;
  error?: string;
  /** Replies that passed the validator, as the app would show them (at most 3). */
  shown: string[];
  /** Reply lines the model produced. */
  rawReplies: number;
  /** Reply lines the validator dropped (unknown note or unsupported detail). */
  blocked: number;
  judgement: Judgement | null;
  keystrokesSaved: number;
  /** Every note the intended reply needs was among the notes sent. */
  noteRecall: boolean;
  firstReplyMs: number | null;
  totalMs: number | null;
}

export interface ModelSummary {
  model: string;
  scenarios: number;
  failed: number;
  judgeErrors: number;
  hitRate: number;
  inventedShown: number;
  shownReplies: number;
  blockedRate: number;
  keystrokesSaved: number;
  noteRecall: number;
  avgShown: number;
  firstReplyP50: number | null;
  firstReplyP95: number | null;
  totalP50: number | null;
  totalP95: number | null;
}

/** Reads the judge's JSON answer. Null when it can't be read. */
export function parseJudgement(text: string, candidates: number): Judgement | null {
  const found = text.match(/\{[\s\S]*\}/);
  if (!found) return null;
  try {
    const j = JSON.parse(found[0]) as { match?: unknown; invented?: unknown };
    const inRange = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= candidates;
    return {
      match: inRange(j.match) ? j.match : 0,
      invented: Array.isArray(j.invented) ? [...new Set(j.invented.filter(inRange))] : [],
    };
  } catch {
    return null;
  }
}

/** Share of keystrokes saved against typing the intended sentence in full. A tap on a reply costs one. */
export function keystrokesSaved(intended: string, typed: string, hit: boolean): number {
  if (!hit || intended.length === 0) return 0;
  return Math.max(0, 1 - (typed.length + 1) / intended.length);
}

const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);
const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

export function summarize(model: string, results: ScenarioResult[]): ModelSummary {
  const ok = results.filter((r) => r.ok);
  const judged = ok.filter((r) => r.judgement !== null);
  const shownReplies = sum(ok.map((r) => r.shown.length));
  const firsts = ok.map((r) => r.firstReplyMs).filter((v): v is number => v !== null);
  const totals = ok.map((r) => r.totalMs).filter((v): v is number => v !== null);
  return {
    model,
    scenarios: results.length,
    failed: results.length - ok.length,
    judgeErrors: ok.length - judged.length,
    hitRate: ratio(judged.filter((r) => r.judgement!.match > 0).length, judged.length),
    inventedShown: sum(judged.map((r) => r.judgement!.invented.length)),
    shownReplies,
    blockedRate: ratio(sum(ok.map((r) => r.blocked)), sum(ok.map((r) => r.rawReplies))),
    keystrokesSaved: ratio(sum(ok.map((r) => r.keystrokesSaved)), ok.length),
    noteRecall: ratio(ok.filter((r) => r.noteRecall).length, ok.length),
    avgShown: ratio(shownReplies, ok.length),
    firstReplyP50: percentile(firsts, 50),
    firstReplyP95: percentile(firsts, 95),
    totalP50: percentile(totals, 50),
    totalP95: percentile(totals, 95),
  };
}

export function toMarkdown(summaries: ModelSummary[]): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const ms = (x: number | null) => (x === null ? "n/a" : `${Math.round(x)} ms`);
  return [
    "| Model | Top-3 hit rate | Invented details shown | Replies blocked by the check | Keystrokes saved | Right notes sent | First reply p50 / p95 | Full answer p50 / p95 | Failed |",
    "|---|---|---|---|---|---|---|---|---|",
    ...summaries.map(
      (s) =>
        `| ${s.model} | ${pct(s.hitRate)} | ${s.inventedShown} of ${s.shownReplies} | ${pct(s.blockedRate)} | ${pct(s.keystrokesSaved)} | ${pct(s.noteRecall)} | ${ms(s.firstReplyP50)} / ${ms(s.firstReplyP95)} | ${ms(s.totalP50)} / ${ms(s.totalP95)} | ${s.failed} |`,
    ),
  ].join("\n");
}
