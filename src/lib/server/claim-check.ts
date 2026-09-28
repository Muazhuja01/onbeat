import type { ChatMessage } from "@/lib/suggest/prompt";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export interface ClaimCheckInput {
  reply: string;
  notes: string[];
  partnerSaid: string;
  typed: string;
  contextLine: string;
  phrases: string[];
}

export type ClaimVerdict = "ok" | "invented" | "unknown";

export function claimCheckMessages(c: ClaimCheckInput): ChatMessage[] {
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "(none)");
  const lines = [
    `Reply: "${c.reply}"`,
    `Situation: ${c.contextLine}`,
    `The other person said: "${c.partnerSaid}"`,
    `The person typed: "${c.typed}"`,
    "Facts about the person:",
    list(c.notes),
    "Things the person has said before:",
    list(c.phrases),
    "",
    "Does the reply state anything about the person that none of the above backs: what they did, have, feel, want, plan or prefer, or a name, place, number, day or time?",
    "Politeness, yes or no, agreeing, declining and questions are fine.",
    "Answer with one word: ok or invented.",
  ];
  return [
    { role: "system", content: "You check replies for a communication aid. You answer with one word." },
    { role: "user", content: lines.join("\n") },
  ];
}

/**
 * Asks a small, fast model whether a reply states something about the person that
 * the sources don't back. Any error, timeout or unclear answer is "unknown", so a
 * slow or failing checker never hides replies (quality pass spec 4.5).
 */
export async function checkReply(
  input: ClaimCheckInput,
  opts: { apiKey: string | undefined; model?: string; timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<ClaimVerdict> {
  if (!opts.apiKey) return "unknown";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 600);
  try {
    const res = await fetchImpl(GROQ_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model: opts.model ?? process.env.CLAIM_CHECK_MODEL ?? "llama-3.1-8b-instant",
        messages: claimCheckMessages(input),
        temperature: 0,
        max_tokens: 3,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return "unknown";
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = (data.choices?.[0]?.message?.content ?? "").toLowerCase();
    if (text.includes("invented")) return "invented";
    if (/\bok\b/.test(text)) return "ok";
    return "unknown";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}
