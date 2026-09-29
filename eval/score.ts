import { percentile } from "@/lib/stats";

export interface Judgement {
  /** 1-based number of the first shown reply that says what the user meant; 0 if none. */
  match: number;
  /** 1-based numbers of shown replies that state a fact the sources don't back up. */
  invented: number[];
  /** The unbacked facts the judge named, for the write-up. */
  unbacked: { n: number; fact: string }[];
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
  /** The model's output, cut to 2000 characters, kept only when no reply was shown. */
  raw?: string;
  /** Who answered the judge call: "groq" or "cloudflare", or "cache:<endpoint>" when a stored answer from that endpoint was reused. Absent when nothing was judged or the judge failed. */
  judgedBy?: string;
  /** Replies the claim check dropped. Only set with --claim-check. */
  checkBlocked?: number;
  /** Replies the claim check could not decide on. Only set with --claim-check. */
  checkUnknown?: number;
}

export interface ModelSummary {
  model: string;
  scenarios: number;
  failed: number;
  judgeErrors: number;
  hitRate: number;
  inventedShown: number;
  shownReplies: number;
  /** Answered scenarios that showed no reply at all. */
  empty: number;
  /** Replies shown in judged scenarios: the base for the invented rate. */
  judgedReplies: number;
  blockedRate: number;
  keystrokesSaved: number;
  noteRecall: number;
  avgShown: number;
  firstReplyP50: number | null;
  firstReplyP95: number | null;
  totalP50: number | null;
  totalP95: number | null;
  /** Replies the claim check dropped (only with --claim-check). */
  checkBlocked: number;
  /** Replies the claim check could not decide on (only with --claim-check). */
  checkUnknown: number;
}

/** Reads the judge's JSON answer. Null when it can't be read. */
export function parseJudgement(text: string, candidates: number): Judgement | null {
  const found = text.match(/\{[\s\S]*\}/);
  if (!found) return null;
  let j: { match?: unknown; invented?: unknown; replies?: unknown };
  try {
    j = JSON.parse(found[0]);
  } catch {
    return null;
  }
  const inRange = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= candidates;
  const unbacked: { n: number; fact: string }[] = [];
  if (Array.isArray(j.replies)) {
    for (const r of j.replies as { n?: unknown; facts?: unknown }[]) {
      if (!inRange(r?.n) || !Array.isArray(r.facts)) continue;
      for (const f of r.facts as { fact?: unknown; source?: unknown }[]) {
        if (String(f?.source ?? "").trim().toLowerCase() === "none") unbacked.push({ n: r.n, fact: String(f.fact ?? "") });
      }
    }
  }
  const fromFacts = unbacked.map((u) => u.n);
  const fromList = Array.isArray(j.invented) ? j.invented.filter(inRange) : [];
  return {
    match: inRange(j.match) ? j.match : 0,
    invented: [...new Set([...fromFacts, ...fromList])].sort((a, b) => a - b),
    unbacked,
  };
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
    empty: ok.filter((r) => r.shown.length === 0).length,
    judgedReplies: sum(judged.map((r) => r.shown.length)),
    blockedRate: ratio(sum(ok.map((r) => r.blocked)), sum(ok.map((r) => r.rawReplies))),
    keystrokesSaved: ratio(sum(judged.map((r) => r.keystrokesSaved)), judged.length),
    noteRecall: ratio(ok.filter((r) => r.noteRecall).length, ok.length),
    avgShown: ratio(shownReplies, ok.length),
    firstReplyP50: percentile(firsts, 50),
    firstReplyP95: percentile(firsts, 95),
    totalP50: percentile(totals, 50),
    totalP95: percentile(totals, 95),
    checkBlocked: sum(ok.map((r) => r.checkBlocked ?? 0)),
    checkUnknown: sum(ok.map((r) => r.checkUnknown ?? 0)),
  };
}

/** "groq (40, 12 cached), cloudflare (8)": who answered the judge calls across these results, cache hits counted under the endpoint that first answered. */
export function judgedByPhrase(results: ScenarioResult[]): string {
  const counts = new Map<string, { total: number; cached: number }>();
  for (const r of results) {
    if (!r.judgedBy) continue;
    const cached = r.judgedBy.startsWith("cache:");
    const name = cached ? r.judgedBy.slice("cache:".length) : r.judgedBy;
    const c = counts.get(name) ?? { total: 0, cached: 0 };
    c.total++;
    if (cached) c.cached++;
    counts.set(name, c);
  }
  const order = ["groq", "cloudflare"];
  const names = [...order.filter((n) => counts.has(n)), ...[...counts.keys()].filter((n) => !order.includes(n)).sort()];
  return names.length ? names.map((n) => { const c = counts.get(n)!; return `${n} (${c.total}${c.cached ? `, ${c.cached} cached` : ""})`; }).join(", ") : "no judge";
}

export function toMarkdown(summaries: ModelSummary[]): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const ms = (x: number | null) => (x === null ? "n/a" : `${Math.round(x)} ms`);
  return [
    "| Model | Top-3 hit rate | Invented details | Empty | Replies blocked by the check | Keystrokes saved | Right notes sent | First reply p50 / p95 | Full answer p50 / p95 | Failed | Not judged | Dropped by the claim check | Claim check unsure |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...summaries.map(
      (s) =>
        `| ${s.model} | ${pct(s.hitRate)} | ${s.inventedShown} of ${s.judgedReplies} (${pct(ratio(s.inventedShown, s.judgedReplies))}) | ${s.empty} | ${pct(s.blockedRate)} | ${pct(s.keystrokesSaved)} | ${pct(s.noteRecall)} | ${ms(s.firstReplyP50)} / ${ms(s.firstReplyP95)} | ${ms(s.totalP50)} / ${ms(s.totalP95)} | ${s.failed} | ${s.judgeErrors} | ${s.checkBlocked} | ${s.checkUnknown} |`,
    ),
  ].join("\n");
}

export function resultFiles(input: {
  ranAt: string;
  set: string;
  judgeModel: string;
  summaries: ModelSummary[];
  results: Record<string, ScenarioResult[]>;
  scenarioCount: number;
  claimCheck: boolean;
  modelsDone: number;
  modelsTotal: number;
}): { json: string; md: string } {
  const { ranAt, set, judgeModel, summaries, results, scenarioCount, claimCheck, modelsDone, modelsTotal } = input;

  // Build JSON: same as current, but with modelsDone and modelsTotal added after set
  const jsonObj = { ranAt, set, modelsDone, modelsTotal, judgeModel, summaries, results };
  const json = `${JSON.stringify(jsonObj, null, 2)}\n`;

  // Build markdown header
  const judgedResults = Object.values(results).flat();
  const headerSentence = `# Eval results\n\nRun ${ranAt.slice(0, 10)}, ${set} set, ${scenarioCount} scenarios per model, judged by ${judgedByPhrase(judgedResults)}${claimCheck ? " with the claim check" : ""}. Generated by \`npm run eval -- --set ${set}\`.${modelsDone < modelsTotal ? ` Partial: ${modelsDone} of ${modelsTotal} models done.` : ""}`;
  const md = `${headerSentence}\n\n${toMarkdown(summaries)}\n`;

  return { json, md };
}
