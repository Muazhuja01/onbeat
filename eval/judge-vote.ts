import { unreadableWhy, type CachedAnswer } from "./judge-cache";
import type { Judgement } from "./score";

/**
 * Majority of several judge calls on the same replies. A reply counts as invented when
 * more than half of the requested calls flag it (2 of 3). match is the value most calls
 * gave, or the first call's when no value has a majority. A call that could not be read
 * counts as not flagging anything; null when fewer calls were read than a majority needs.
 */
export function voteJudgements(calls: (Judgement | null)[], votes = calls.length): Judgement | null {
  const need = Math.floor(votes / 2) + 1;
  const read = calls.filter((c): c is Judgement => c !== null);
  if (read.length < need) return null;

  const counts = new Map<number, number>();
  for (const c of read) for (const n of c.invented) counts.set(n, (counts.get(n) ?? 0) + 1);
  const invented = [...counts].filter(([, k]) => k >= need).map(([n]) => n).sort((a, b) => a - b);

  const matches = new Map<number, number>();
  for (const c of read) matches.set(c.match, (matches.get(c.match) ?? 0) + 1);
  const majority = [...matches].find(([, k]) => k >= need);
  const match = majority ? majority[0] : read[0].match;

  const seen = new Set<string>();
  const unbacked = read
    .flatMap((c) => c.unbacked)
    .filter((u) => invented.includes(u.n))
    .filter((u) => {
      const key = `${u.n}:${u.fact.trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { match, invented, unbacked };
}

/** A judgement written the way the judge answers, so parseJudgement reads it back unchanged. */
export function judgementText(j: Judgement): string {
  const replies = j.invented.map((n) => ({ n, facts: j.unbacked.filter((u) => u.n === n).map((u) => ({ fact: u.fact, source: "none" })) }));
  return JSON.stringify({ match: j.match, invented: j.invented, replies });
}

/** "groq x3", or "groq x2+cloudflare x1" when a spent endpoint handed over part way, plus " (2 readable)" when some votes could not be read. */
export function votedBy(endpoints: string[], readable = endpoints.length): string {
  const counts = new Map<string, number>();
  for (const e of endpoints) counts.set(e, (counts.get(e) ?? 0) + 1);
  const named = [...counts].map(([e, k]) => `${e} x${k}`).join("+");
  return readable < endpoints.length ? `${named} (${readable} readable)` : named;
}

/**
 * Asks the judge `votes` times and returns one answer holding the majority judgement, in
 * the shape the judge cache stores. A call whose answer can't be read is asked once more
 * before it counts as unreadable. A voted judgement still needs a majority of readable
 * calls; without one the answer is empty and its note says why. With one vote it is a
 * single plain call. Throws when a call fails, like a single call would.
 */
export async function askVoted(ask: () => Promise<CachedAnswer>, parse: (text: string) => Judgement | null, votes: number): Promise<CachedAnswer> {
  if (votes <= 1) return ask();
  const answers: CachedAnswer[] = [];
  const calls: (Judgement | null)[] = [];
  const unreadable: string[] = [];
  for (let i = 0; i < votes; i++) {
    let answer = await ask();
    let judgement = parse(answer.text);
    if (!judgement) {
      answer = await ask();
      judgement = parse(answer.text);
    }
    answers.push(answer);
    calls.push(judgement);
    if (!judgement) unreadable.push(unreadableWhy(answer));
  }
  const judgement = voteJudgements(calls, votes);
  const readableVotes = calls.filter((c) => c !== null).length;
  const endpoint = votedBy(answers.map((a) => a.endpoint), readableVotes);
  if (judgement) return { text: judgementText(judgement), endpoint, model: answers[0].model, readableVotes };
  const note = `judge answer unreadable after a retry (${votes - unreadable.length} of ${votes} votes readable; unreadable: ${unreadable.join("; ")})`;
  return { text: "", endpoint, model: answers[0].model, note };
}
