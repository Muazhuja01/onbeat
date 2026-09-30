import { retryAfterMs, type ProviderCooldown } from "@/lib/server/providers";
import type { ChatMessage } from "@/lib/suggest/prompt";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
/** The simulated user's model, kept apart from EVAL_JUDGE_MODEL so changing the judge doesn't change the chats. */
export const SIM_MODEL = "openai/gpt-oss-120b";

export const DONE = "[done]";

/** The simulated user sees only their brief and the chat, never the notes or the assistant's instructions. */
export function simUserMessages(brief: string, lines: { speaker: "user" | "assistant"; text: string }[]): ChatMessage[] {
  const content = [
    "You are playing a person who cannot speak and types to an app's assistant. Typing is slow for you, so you answer in a few words.",
    "",
    "What you want, and everything you know (never say anything that isn't here):",
    brief,
    "",
    "The chat so far:",
    lines.map((l) => `${l.speaker === "user" ? "You" : "Assistant"}: ${l.text}`).join("\n"),
    "",
    "Write your next message only. Answer what the assistant asked; don't add facts it didn't ask for unless your brief says you want to tell it. If you have nothing more to add, or the assistant has done what you wanted and asks if there is anything else, reply with a short goodbye followed by " + DONE + ".",
  ].join("\n");
  return [
    { role: "system", content: "You play a user in a test. Stay in character. Output only the message you would type." },
    { role: "user", content },
  ];
}

export function parseSimReply(text: string): { text: string; done: boolean } {
  const done = text.includes(DONE);
  return { text: text.replace(DONE, "").trim(), done };
}

/**
 * One simulated user message. A direct call rather than judgeChat, which fixes temperature
 * at 0: a little warmth keeps the user from typing the same words in every case. A 429 is
 * recorded on the cooldown, so withRetry waits and asks again.
 */
export async function askSimUser(messages: ChatMessage[], opts: { apiKey: string; cooldown: ProviderCooldown; fetchImpl?: typeof fetch }): Promise<string> {
  const res = await (opts.fetchImpl ?? fetch)(GROQ_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({ model: SIM_MODEL, messages, temperature: 0.3, max_tokens: 2000, reasoning_effort: "low" }),
  });
  if (res.status === 429) {
    opts.cooldown.block("groq", retryAfterMs(res.headers.get("retry-after")));
    throw new Error("simulated user: HTTP 429");
  }
  if (!res.ok) throw new Error(`simulated user: HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}
