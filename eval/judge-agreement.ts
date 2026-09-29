/** Replies of one gold entry, with the ones a person labelled invented (1-based). */
export interface GoldLabels {
  id: string;
  candidates: string[];
  invented: number[];
}

/** What one judge said per entry: the invented reply numbers, or null when it gave no usable answer. */
export type JudgeVerdicts = Map<string, number[] | null>;

export interface Disagreement {
  id: string;
  n: number;
  gold: boolean;
  judge: boolean;
  text: string;
}

export interface GoldComparison {
  /** Replies in entries the judge answered. */
  replies: number;
  /** Replies where the judge and the gold label agree on invented or not. */
  agree: number;
  /** Gold-invented replies in answered entries. */
  goldInvented: number;
  /** Gold-invented replies the judge also flagged. */
  caught: number;
  /** Replies the judge flagged that the gold label does not. */
  falseFlags: number;
  /** Entries the judge did not answer, left out of every count. */
  notJudged: string[];
  disagreements: Disagreement[];
}

/** Reply-level comparison of one judge's verdicts with the hand labels. */
export function compareToGold(gold: GoldLabels[], judged: JudgeVerdicts): GoldComparison {
  const out: GoldComparison = { replies: 0, agree: 0, goldInvented: 0, caught: 0, falseFlags: 0, notJudged: [], disagreements: [] };
  for (const g of gold) {
    const verdict = judged.get(g.id);
    if (!verdict) {
      out.notJudged.push(g.id);
      continue;
    }
    g.candidates.forEach((text, i) => {
      const n = i + 1;
      const goldYes = g.invented.includes(n);
      const judgeYes = verdict.includes(n);
      out.replies++;
      if (goldYes) out.goldInvented++;
      if (goldYes && judgeYes) out.caught++;
      if (!goldYes && judgeYes) out.falseFlags++;
      if (goldYes === judgeYes) out.agree++;
      else out.disagreements.push({ id: g.id, n, gold: goldYes, judge: judgeYes, text });
    });
  }
  return out;
}

/** How often two judges agree on invented or not, over the replies both answered. */
export function endpointAgreement(gold: GoldLabels[], a: JudgeVerdicts, b: JudgeVerdicts): { replies: number; agree: number } {
  let replies = 0;
  let agree = 0;
  for (const g of gold) {
    const va = a.get(g.id);
    const vb = b.get(g.id);
    if (!va || !vb) continue;
    for (let n = 1; n <= g.candidates.length; n++) {
      replies++;
      if (va.includes(n) === vb.includes(n)) agree++;
    }
  }
  return { replies, agree };
}
