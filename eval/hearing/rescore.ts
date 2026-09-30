/**
 * Scores saved hearing runs again with the current scorer, so runs made
 * before a scoring change can be compared with newer ones.
 *
 *   npx tsx eval/hearing/rescore.ts eval/results/hearing-dev-*.json
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { scoreClip, summarize, type ClipScore } from "./score";

interface Saved {
  label: string;
  results: { clip: { source: string; text: string }; condition: string; turns: string[]; asrMs: number }[];
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Give one or more saved run files (eval/results/hearing-*.json).");
  process.exit(1);
}

console.log("| Run | Word errors, all | CV quiet | CV café | CV street | AMI quiet | Exact | Cut off | Split | Missed | Time per clip |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const file of files) {
  const saved = JSON.parse(readFileSync(file, "utf8")) as Saved;
  const scored = saved.results.map((r) => ({ ...r, score: scoreClip(r.clip.text, r.turns) }));
  const pick = (source: string, condition: string): ClipScore[] =>
    scored.filter((r) => r.clip.source === source && r.condition.startsWith(condition)).map((r) => r.score);
  const all = summarize(scored.map((r) => r.score));
  const cell = (source: string, condition: string) => pct(summarize(pick(source, condition)).wer);
  console.log(
    `| ${saved.label || basename(file)} | ${pct(all.wer)} | ${cell("cv", "quiet")} | ${cell("cv", "cafe")} | ${cell("cv", "street")} | ${cell("ami", "quiet")} | ${pct(all.exact)} | ${pct(all.cutOff)} | ${pct(all.split)} | ${pct(all.missed)} | ${Math.round(median(scored.map((r) => r.asrMs)))} ms |`,
  );
}
