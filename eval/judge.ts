import { groqExtraBody, retryAfterMs } from "@/lib/server/providers";
import type { ChatMessage } from "@/lib/suggest/prompt";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export interface JudgeInput {
  intended: string;
  partnerSaid: string;
  typed: string;
  contextLine: string;
  /** Texts of the notes that were sent with the request: the only facts replies may use. */
  notes: string[];
  candidates: string[];
}

export function judgeMessages(j: JudgeInput): ChatMessage[] {
  const lines = [
    "A person who cannot speak picks one of the suggested replies below and the app says it out loud for them.",
    `Situation: ${j.contextLine}`,
    `The other person said: "${j.partnerSaid}"`,
    `The person had typed: "${j.typed}"`,
    "Facts the replies may use:",
    j.notes.length ? j.notes.map((n) => `- ${n}`).join("\n") : "(none)",
    "",
    `What the person meant to say: "${j.intended}"`,
    "",
    "Suggested replies:",
    j.candidates.map((c, i) => `${i + 1}. ${c}`).join("\n"),
    "",
    "Give two things:",
    "match: the number of the first reply that says what the person meant closely enough that they would pick it (same meaning, wording may differ), or 0 if none does.",
    "invented: the numbers of replies that state a specific fact (a name, place, number, day, time, or a claim about the person's life) that is not in the facts, the situation, what the other person said, or what the person typed.",
    'Answer with one JSON object and nothing else, like {"match": 2, "invented": []}',
  ];
  return [
    { role: "system", content: "You grade reply suggestions for a communication aid. You answer with one JSON object." },
    { role: "user", content: lines.join("\n") },
  ];
}

/** Asks the judge model on Groq. Returns its raw text; parse it with parseJudgement. */
export async function judge(
  input: JudgeInput,
  opts: { apiKey: string; model: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> },
): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const call = (jsonMode: boolean) =>
    fetchImpl(GROQ_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model: opts.model,
        messages: judgeMessages(input),
        temperature: 0,
        max_tokens: 1000,
        ...groqExtraBody(opts.model),
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  let res = await call(true);
  if (res.status === 429) {
    await sleep(Math.min(60_000, retryAfterMs(res.headers.get("retry-after"))));
    res = await call(true);
  }
  // Some models reject JSON mode; ask again without it.
  if (res.status === 400) res = await call(false);
  if (!res.ok) throw new Error(`judge HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}
