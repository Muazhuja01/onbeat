import { personas } from "@/data/personas";
import { judgeChat, judgeEndpoints } from "../judge";
import { loadLocalEnv } from "./env";
import { learnJudgeMessages, parseLearnVerdicts } from "./judge";
import { learnGold } from "./judge-gold";
import { EVAL_TODAY, learnScenarios } from "./scenarios";

loadLocalEnv();

/**
 * Judges every gold entry once per endpoint and reports agreement with the hand labels.
 * The notes shown are the persona's full notes, not what search sent, so a gold label
 * never depends on search.
 */
async function main() {
  for (const ep of judgeEndpoints()) {
    let keepAgree = 0;
    let inventedAgree = 0;
    let total = 0;
    for (const g of learnGold) {
      const sc = learnScenarios.find((s) => s.id === g.scenarioId)!;
      const persona = personas.find((p) => p.id === sc.persona)!;
      const partnerName = sc.partnerId ? persona.notes.find((n) => n.id === sc.partnerId)?.entities[0] : undefined;
      const messages = learnJudgeMessages({
        today: EVAL_TODAY,
        lines: sc.lines.map((l) => ({ ...l, ...(l.speaker === "partner" && partnerName ? { partnerName } : {}) })),
        notes: persona.notes.map((n) => n.text),
        expected: sc.expected.map((e) => ({ ...e, ...(e.noteId ? { oldText: persona.notes.find((n) => n.id === e.noteId)?.text } : {}) })),
        shown: g.shown,
      });
      let verdicts = null;
      try {
        verdicts = parseLearnVerdicts((await judgeChat(messages, { endpoints: [ep] })).text, g.shown.length);
      } catch (err) {
        console.log(`${ep.name} ${g.scenarioId}: judge failed (${err instanceof Error ? err.message : String(err)})`);
      }
      g.labels.forEach((label, i) => {
        total++;
        const v = verdicts?.[i];
        if (v && v.keep === label.keep) keepAgree++;
        else console.log(`${ep.name} ${g.scenarioId} #${i + 1}: keep ${v?.keep} vs ${label.keep}`);
        if (v && v.invented.length > 0 === label.invented) inventedAgree++;
        else console.log(`${ep.name} ${g.scenarioId} #${i + 1}: invented ${JSON.stringify(v?.invented)} vs ${label.invented}`);
      });
    }
    console.log(`${ep.name}: keep ${keepAgree}/${total}, invented ${inventedAgree}/${total}`);
  }
}

void main();
