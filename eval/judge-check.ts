import { judge, judgeEndpoints, JUDGE_VOTES, type JudgeEndpoint } from "./judge";
import { compareToGold, endpointAgreement, type JudgeVerdicts } from "./judge-agreement";
import { judgeGold } from "./judge-gold";
import { scenarioJudgeInput } from "./judge-input";
import { askVoted } from "./judge-vote";
import { scenarios } from "./scenarios";
import { parseJudgement } from "./score";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Keys can also come from the environment.
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${Math.round((a / b) * 100)}%`);

/**
 * Judges every gold entry with one endpoint only, straight from the API (the judge
 * cache is neither read nor written). Null when the endpoint ran out of quota, since a
 * partial run would read as a worse judge.
 */
async function runEndpoint(ep: JudgeEndpoint, delay: number, showFacts: boolean, votes: number): Promise<JudgeVerdicts | null> {
  const spent = new Set<string>();
  const verdicts: JudgeVerdicts = new Map();
  const facts = new Map<string, { n: number; fact: string }[]>();
  for (const g of judgeGold) {
    const sc = scenarios.find((s) => s.id === g.id)!;
    const input = { ...(await scenarioJudgeInput(sc)), candidates: g.candidates };
    try {
      const parse = (text: string) => parseJudgement(text, g.candidates.length);
      const { text } = await askVoted(() => judge(input, { endpoints: [ep], spent }), parse, votes);
      const j = parse(text);
      verdicts.set(g.id, j ? j.invented : null);
      if (j) facts.set(g.id, j.unbacked);
      if (!j) console.log(`  ${g.id}: could not read the judge's answer`);
    } catch (err) {
      if (spent.has(ep.name)) {
        console.log(`${ep.name}: not run (out of quota at ${g.id}, after ${verdicts.size} of ${judgeGold.length} entries; try a longer --delay)`);
        return null;
      }
      console.log(`  ${g.id}: ${err instanceof Error ? err.message : String(err)}`);
      verdicts.set(g.id, null);
    }
    await sleep(delay);
  }

  const r = compareToGold(judgeGold, verdicts);
  console.log(`${ep.name} (${ep.model}, ${JSON.stringify(ep.extraBody)}, ${votes === 1 ? "one call" : `majority of ${votes} calls`} per entry)`);
  console.log(`  agreement with gold: ${r.agree} of ${r.replies} replies (${pct(r.agree, r.replies)})`);
  console.log(`  recall of invented replies: ${r.caught} of ${r.goldInvented} (${pct(r.caught, r.goldInvented)})`);
  console.log(`  false flags: ${r.falseFlags}`);
  if (r.notJudged.length) console.log(`  not judged: ${r.notJudged.join(", ")}`);
  for (const d of r.disagreements) {
    console.log(`  ${d.id} reply ${d.n}: gold ${d.gold ? "yes" : "no"}, judge ${d.judge ? "yes" : "no"}: "${d.text}"`);
    if (showFacts && d.judge) for (const f of facts.get(d.id)?.filter((u) => u.n === d.n) ?? []) console.log(`    unbacked: ${f.fact}`);
  }
  return verdicts;
}

async function main() {
  const which = arg("endpoint") ?? "all";
  if (!["groq", "cloudflare", "all"].includes(which)) throw new Error(`Unknown endpoint "${which}". Use --endpoint groq, cloudflare or all.`);
  const delay = Number(arg("delay") ?? 1000);
  const showFacts = process.argv.includes("--facts");
  const votes = Number(arg("votes") ?? JUDGE_VOTES);
  if (!Number.isInteger(votes) || votes < 1) throw new Error(`--votes must be a whole number of at least 1, not "${arg("votes")}".`);
  const effort = arg("effort");
  const configured = judgeEndpoints();
  const names = which === "all" ? ["groq", "cloudflare"] : [which];
  const results = new Map<string, JudgeVerdicts>();
  for (const name of names) {
    const found = configured.find((e) => e.name === name);
    // --effort overrides the reasoning setting for this check only, to compare settings before changing the default.
    const ep = found && effort ? { ...found, extraBody: { ...found.extraBody, reasoning_effort: effort } } : found;
    if (!ep) {
      console.log(`${name}: not run (keys not set)`);
      continue;
    }
    const verdicts = await runEndpoint(ep, delay, showFacts, votes);
    if (verdicts) results.set(name, verdicts);
  }
  const groq = results.get("groq");
  const cloudflare = results.get("cloudflare");
  if (groq && cloudflare) {
    const a = endpointAgreement(judgeGold, groq, cloudflare);
    console.log(`groq and cloudflare agree on ${a.agree} of ${a.replies} replies (${pct(a.agree, a.replies)})`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
