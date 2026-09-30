import { percentile } from "@/lib/stats";
import type { LearnVerdict, ShownSuggestion } from "./judge";
import type { ExpectedFact } from "./scenarios";

export interface LearnScenarioResult {
  id: string;
  model: string;
  expected: ExpectedFact[];
  shown: ShownSuggestion[];
  /** Null when the judge couldn't be read. */
  verdicts: LearnVerdict[] | null;
  ms: number;
  /** The model or search failed; nothing was shown. */
  error?: string;
  /** Texts of the notes sent, kept so a later run can judge without regenerating. */
  notes?: string[];
  /** The judge failed (usually quota); verdicts stay null until --rejudge. */
  judgeError?: string;
}

export interface LearnSummary {
  model: string;
  scenarios: number;
  /** Suggestions shown in judged scenarios. */
  shown: number;
  kept: number;
  invented: number;
  expected: number;
  /** Expected facts recorded by a suggestion judged worth keeping. */
  found: number;
  edits: number;
  /** Expected edits recorded as an edit of the right note. */
  editsRight: number;
  unjudged: number;
  errors: number;
  p50ms: number | null;
}

export function summarizeLearning(model: string, results: LearnScenarioResult[]): LearnSummary {
  const s: LearnSummary = { model, scenarios: results.length, shown: 0, kept: 0, invented: 0, expected: 0, found: 0, edits: 0, editsRight: 0, unjudged: 0, errors: 0, p50ms: null };
  for (const r of results) {
    if (r.error) {
      s.errors++;
      continue;
    }
    s.expected += r.expected.length;
    s.edits += r.expected.filter((e) => e.action === "edit").length;
    if (!r.verdicts) {
      s.unjudged++;
      continue;
    }
    s.shown += r.shown.length;
    const found = new Set<number>();
    r.verdicts.forEach((v, i) => {
      if (v.keep) s.kept++;
      if (v.invented.length > 0) s.invented++;
      if (v.keep && v.matches !== null && !found.has(v.matches)) {
        found.add(v.matches);
        const e = r.expected[v.matches - 1];
        const shown = r.shown[i];
        if (e?.action === "edit" && shown.action === "edit" && shown.noteId === e.noteId) s.editsRight++;
      }
    });
    s.found += found.size;
  }
  s.p50ms = percentile(results.filter((r) => !r.error).map((r) => r.ms), 50);
  return s;
}

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${Math.round((a / b) * 100)}% (${a}/${b})`);

export function learningMarkdown(summaries: LearnSummary[]): string {
  const head = "| Model | Scenarios | Shown | Worth keeping (target 80%) | Invented (target under 5%) | Edits right (target 90%) | Recall | Batch p50 |";
  const rule = "|---|---|---|---|---|---|---|---|";
  const rows = summaries.map(
    (s) =>
      `| ${s.model} | ${s.scenarios}${s.errors ? ` (${s.errors} failed)` : ""}${s.unjudged ? ` (${s.unjudged} unjudged)` : ""} | ${s.shown} | ${pct(s.kept, s.shown)} | ${pct(s.invented, s.shown)} | ${pct(s.editsRight, s.edits)} | ${pct(s.found, s.expected)} | ${s.p50ms === null ? "n/a" : `${s.p50ms} ms`} |`,
  );
  return [head, rule, ...rows].join("\n");
}
