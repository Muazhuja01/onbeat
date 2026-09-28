import { groqExtraBody, retryAfterMs } from "@/lib/server/providers";
import type { ChatMessage } from "@/lib/suggest/prompt";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Bump when the judge prompt changes, so cached judgements from the old prompt are not reused. */
export const JUDGE_PROMPT_VERSION = 2;

export interface JudgeInput {
  intended: string;
  partnerSaid: string;
  typed: string;
  contextLine: string;
  /** Texts of the notes that were sent with the request: the only facts replies may use. */
  notes: string[];
  /** Saved phrases sent to the model as style examples: the person's own words. */
  phrases: string[];
  candidates: string[];
}

export interface JudgeEndpoint {
  name: string;
  url: string;
  apiKey: string;
  model: string;
  extraBody: Record<string, unknown>;
}

/** The same judge model on Groq, then on Cloudflare Workers AI, each only when its keys are set. */
export function judgeEndpoints(env: NodeJS.ProcessEnv = process.env): JudgeEndpoint[] {
  const list: JudgeEndpoint[] = [];
  const groqModel = env.EVAL_JUDGE_MODEL ?? "openai/gpt-oss-120b";
  if (env.GROQ_API_KEY) list.push({ name: "groq", url: GROQ_URL, apiKey: env.GROQ_API_KEY, model: groqModel, extraBody: groqExtraBody(groqModel) });
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN) {
    list.push({
      name: "cloudflare",
      url: `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`,
      apiKey: env.CLOUDFLARE_API_TOKEN,
      model: env.EVAL_JUDGE_CF_MODEL ?? "@cf/openai/gpt-oss-120b",
      extraBody: {},
    });
  }
  return list;
}

export function judgeMessages(j: JudgeInput): ChatMessage[] {
  const lines = [
    "A person who cannot speak picks one of the suggested replies below and the app says it out loud for them.",
    `Situation: ${j.contextLine}`,
    `The other person said: "${j.partnerSaid}"`,
    `The person had typed: "${j.typed}"`,
    "Facts the replies may use:",
    j.notes.length ? j.notes.map((n) => `- ${n}`).join("\n") : "(none)",
    ...(j.phrases.length
      ? [
          "Things the person has said before (their own words, so restating one is not an invented detail):",
          j.phrases.map((p) => `- ${p}`).join("\n"),
        ]
      : []),
    "",
    `What the person meant to say: "${j.intended}"`,
    "",
    "Suggested replies:",
    j.candidates.map((c, i) => `${i + 1}. ${c}`).join("\n"),
    "",
    "Give two things:",
    "match: the number of the first reply that says what the person meant closely enough that they would pick it (same meaning, wording may differ), or 0 if none does.",
    "replies: for each reply, the facts it states about the person, their life or the situation (what they did, have, feel, want, plan or prefer, and any name, place, number, day or time). For each fact give its source:",
    '"note" (the facts above), "situation", "partner" (what the other person said), "typed", "phrase" (something the person has said before), or "none" if nothing above backs it.',
    "Politeness, yes or no, agreeing, declining, asking a question, and repeating what the other person said are not facts.",
    'Answer with one JSON object and nothing else, like {"match": 1, "replies": [{"n": 1, "facts": [{"fact": "usual is an oat latte", "source": "note"}]}, {"n": 2, "facts": []}]}',
  ];
  return [
    { role: "system", content: "You grade reply suggestions for a communication aid. You answer with one JSON object." },
    { role: "user", content: lines.join("\n") },
  ];
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Asks the judge, trying each endpoint in order. On one endpoint a 429 is retried
 * three times after its Retry-After (at most 60 s each); a 400 is retried once
 * without JSON mode. Any other failure moves on to the next endpoint.
 * An endpoint that is out of quota (a Retry-After over 60 s, or still 429 after the
 * retries) is added to opts.spent and skipped on later calls that share the set.
 */
export async function judge(
  input: JudgeInput,
  opts: { endpoints: JudgeEndpoint[]; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; spent?: Set<string> },
): Promise<{ text: string; endpoint: string; model: string }> {
  if (opts.endpoints.length === 0) throw new Error("judge failed: no judge endpoint is configured");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const failures: string[] = [];
  const spent = opts.spent ?? new Set<string>();
  for (const ep of opts.endpoints) {
    if (spent.has(ep.name)) {
      failures.push(`${ep.name} out of quota`);
      continue;
    }
    const call = (jsonMode: boolean) =>
      fetchImpl(ep.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ep.apiKey}` },
        body: JSON.stringify({
          model: ep.model,
          messages: judgeMessages(input),
          temperature: 0,
          max_tokens: 1500,
          ...ep.extraBody,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
      });
    try {
      let res = await call(true);
      for (let attempt = 1; attempt < 4 && res.status === 429; attempt++) {
        const wait = retryAfterMs(res.headers.get("retry-after"));
        if (wait > 60_000) break;
        await sleep(wait);
        res = await call(true);
      }
      if (res.status === 429) {
        spent.add(ep.name);
        failures.push(`${ep.name} out of quota`);
        continue;
      }
      // Some models reject JSON mode; ask again without it.
      if (res.status === 400) res = await call(false);
      if (!res.ok) {
        failures.push(`${ep.name} HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return { text: data.choices?.[0]?.message?.content ?? "", endpoint: ep.name, model: ep.model };
    } catch (err) {
      failures.push(`${ep.name} ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`judge failed: ${failures.join("; ")}`);
}
