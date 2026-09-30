import { mkdirSync, writeFileSync } from "node:fs";
import { judgeChat, judgeEndpoints } from "../judge";
import { loadLocalEnv } from "../learning/env";
import { EVAL_TODAY } from "../learning/scenarios";
import { assistCases } from "./cases";
import { assistJudgeMessages, judgeNotes, parseAssistVerdict, type AssistVerdict } from "./judge";
import { assistGold } from "./judge-gold";
import { briefOnlyCards } from "./score";

loadLocalEnv();

const RESULTS_DIR = "eval/assist/results";

/**
 * Judges every gold entry once per endpoint, at the judge's normal settings, and reports
 * agreement with the hand labels: keep, invented (empty or not), sayable (phrases only)
 * and the leak flag. Keep and invented are reported twice: the judge alone, and with the
 * brief-only check (score.ts) applied, which is what the eval counts. Every disagreement is printed
 * with the card, and the raw verdicts are saved so they can be read afterwards.
 */
async function main() {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = `${RESULTS_DIR}/judge-check-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const saved: { endpoint: string; name: string; verdict: AssistVerdict | null; briefOnly?: string[][]; text?: string; finishReason?: string; error?: string }[] = [];
  for (const ep of judgeEndpoints()) {
    const agree = { keep: 0, keepWithCheck: 0, invented: 0, withCheck: 0, sayable: 0, leak: 0 };
    let cards = 0;
    let phrases = 0;
    let outOfQuota = false;
    for (const g of assistGold) {
      const c = assistCases.find((x) => x.id === g.caseId)!;
      const messages = assistJudgeMessages({ today: EVAL_TODAY, brief: c.brief, notes: judgeNotes(c), lines: g.lines, expected: c.expected, cards: g.cards });
      const briefOnly = briefOnlyCards(g.cards, c.briefOnly, g.lines);
      let verdict: AssistVerdict | null = null;
      try {
        const { text, finishReason } = await judgeChat(messages, { endpoints: [ep] });
        verdict = parseAssistVerdict(text, g.cards.length);
        saved.push({ endpoint: ep.name, name: g.name, verdict, briefOnly, ...(verdict ? {} : { text, finishReason }) });
        if (!verdict) console.log(`${ep.name} ${g.name}: judge answer unreadable (${text ? "bad JSON" : "empty"}, finish reason ${finishReason ?? "none"}), counted as disagreeing`);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        saved.push({ endpoint: ep.name, name: g.name, verdict: null, error });
        // A spent endpoint would fail every entry after this one; its numbers would mean nothing.
        if (error.includes("out of quota")) {
          console.log(`${ep.name}: out of quota at ${g.name}, no numbers for this endpoint`);
          outOfQuota = true;
          break;
        }
        console.log(`${ep.name} ${g.name}: judge failed (${error}), counted as disagreeing`);
      }
      writeFileSync(file, JSON.stringify(saved, null, 2));
      if (verdict?.leak === g.leak) agree.leak++;
      else if (verdict) console.log(`${ep.name} ${g.name}: leak ${verdict.leak} vs ${g.leak}`);
      g.labels.forEach((label, i) => {
        cards++;
        if (label.sayable !== null) phrases++;
        const v = verdict?.cards[i];
        if (!v) return;
        const card = `"${g.cards[i].text}"`;
        if (v.keep === label.keep) agree.keep++;
        else console.log(`${ep.name} ${g.name} #${i + 1} ${card}: keep ${v.keep} vs ${label.keep}`);
        const keepWithCheck = v.keep && briefOnly[i].length === 0;
        if (keepWithCheck === label.keep) agree.keepWithCheck++;
        else console.log(`${ep.name} ${g.name} #${i + 1} ${card}: keep with the brief-only check ${keepWithCheck} vs ${label.keep}`);
        if (v.invented.length > 0 === label.invented) agree.invented++;
        else console.log(`${ep.name} ${g.name} #${i + 1} ${card}: invented ${JSON.stringify(v.invented)} vs ${label.invented}`);
        const withCheck = v.invented.length > 0 || briefOnly[i].length > 0;
        if (withCheck === label.invented) agree.withCheck++;
        else console.log(`${ep.name} ${g.name} #${i + 1} ${card}: invented with the brief-only check ${withCheck} vs ${label.invented}`);
        if (briefOnly[i].length) console.log(`${ep.name} ${g.name} #${i + 1} ${card}: brief-only check flags ${briefOnly[i].join(", ")}`);
        if (label.sayable === null) return;
        if (v.sayable === label.sayable) agree.sayable++;
        else console.log(`${ep.name} ${g.name} #${i + 1} ${card}: sayable ${v.sayable} vs ${label.sayable}`);
      });
    }
    if (outOfQuota) continue;
    const pct = (n: number, of: number) => `${n}/${of} (${Math.round((n / of) * 100)}%)`;
    console.log(`${ep.name}: keep ${pct(agree.keep, cards)} (with the brief-only check ${pct(agree.keepWithCheck, cards)}), invented ${pct(agree.invented, cards)} (with the brief-only check ${pct(agree.withCheck, cards)}), sayable ${pct(agree.sayable, phrases)}, leak ${pct(agree.leak, assistGold.length)}`);
  }
  writeFileSync(file, JSON.stringify(saved, null, 2));
  console.log(`saved ${file}`);
}

void main();
