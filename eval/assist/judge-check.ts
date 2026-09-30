import { mkdirSync, writeFileSync } from "node:fs";
import { judgeChat, judgeEndpoints } from "../judge";
import { loadLocalEnv } from "../learning/env";
import { EVAL_TODAY } from "../learning/scenarios";
import { assistCases } from "./cases";
import { assistJudgeMessages, judgeNotes, parseAssistVerdict, type AssistVerdict } from "./judge";
import { assistGold } from "./judge-gold";

loadLocalEnv();

const RESULTS_DIR = "eval/assist/results";

/**
 * Judges every gold entry once per endpoint, at the judge's normal settings, and reports
 * agreement with the hand labels: keep, invented (empty or not), sayable (phrases only)
 * and the leak flag. Every disagreement is printed with the card, and the raw verdicts
 * are saved so they can be read afterwards.
 */
async function main() {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const saved: { endpoint: string; name: string; verdict: AssistVerdict | null; text?: string; error?: string }[] = [];
  for (const ep of judgeEndpoints()) {
    const agree = { keep: 0, invented: 0, sayable: 0, leak: 0 };
    let cards = 0;
    let phrases = 0;
    for (const g of assistGold) {
      const c = assistCases.find((x) => x.id === g.caseId)!;
      const messages = assistJudgeMessages({ today: EVAL_TODAY, brief: c.brief, notes: judgeNotes(c), lines: g.lines, expected: c.expected, cards: g.cards });
      let verdict: AssistVerdict | null = null;
      try {
        const { text } = await judgeChat(messages, { endpoints: [ep] });
        verdict = parseAssistVerdict(text, g.cards.length);
        saved.push({ endpoint: ep.name, name: g.name, verdict, ...(verdict ? {} : { text }) });
        if (!verdict) console.log(`${ep.name} ${g.name}: judge answer unreadable`);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        saved.push({ endpoint: ep.name, name: g.name, verdict: null, error });
        console.log(`${ep.name} ${g.name}: judge failed (${error})`);
      }
      if (verdict?.leak === g.leak) agree.leak++;
      else console.log(`${ep.name} ${g.name}: leak ${verdict?.leak} vs ${g.leak}`);
      g.labels.forEach((label, i) => {
        cards++;
        const v = verdict?.cards[i];
        const card = `"${g.cards[i].text}"`;
        if (v && v.keep === label.keep) agree.keep++;
        else console.log(`${ep.name} ${g.name} #${i + 1} ${card}: keep ${v?.keep} vs ${label.keep}`);
        if (v && v.invented.length > 0 === label.invented) agree.invented++;
        else console.log(`${ep.name} ${g.name} #${i + 1} ${card}: invented ${JSON.stringify(v?.invented)} vs ${label.invented}`);
        if (label.sayable === null) return;
        phrases++;
        if (v && v.sayable === label.sayable) agree.sayable++;
        else console.log(`${ep.name} ${g.name} #${i + 1} ${card}: sayable ${v?.sayable} vs ${label.sayable}`);
      });
    }
    const pct = (n: number, of: number) => `${n}/${of} (${Math.round((n / of) * 100)}%)`;
    console.log(`${ep.name}: keep ${pct(agree.keep, cards)}, invented ${pct(agree.invented, cards)}, sayable ${pct(agree.sayable, phrases)}, leak ${pct(agree.leak, assistGold.length)}`);
  }
  const file = `${RESULTS_DIR}/judge-check-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(saved, null, 2));
  console.log(`saved ${file}`);
}

void main();
