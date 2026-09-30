import { AssistRequestSchema } from "@/lib/assist/protocol";
import { AssistUnreadableError, assistTurn } from "@/lib/assist/server";
import { clientIp, isSameOrigin, json } from "@/lib/server/guard";
import { AllProvidersFailedError, createCooldown, providerConfigs } from "@/lib/server/providers";
import { createRateLimiter } from "@/lib/server/rate-limit";

/** 40 chat lines, 12,000 characters of notes and 100 phrases fit under this. */
const BODY_MAX = 64_000;
// The chat is paced by the user's typing; 10 a minute leaves room for quick answers and a retry.
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });
const cooldown = createCooldown();

/**
 * The assistant: the chat, the notes and the quick phrases go to the model, which answers
 * and proposes changes. Nothing is stored here and nothing is logged. The user confirms
 * every proposal in the browser.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!limiter.check(clientIp(request))) return json({ error: "rate_limited" }, 429);
  if (Number(request.headers.get("content-length")) > BODY_MAX) return json({ error: "too_large" }, 413);

  const raw = await request.text();
  if (raw.length > BODY_MAX) return json({ error: "too_large" }, 413);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const parsed = AssistRequestSchema.safeParse(data);
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const env = process.env;
  const configs = providerConfigs({ ...env, GROQ_MODEL: env.ASSIST_MODEL ?? env.GROQ_MODEL });
  try {
    return json(await assistTurn(parsed.data, { order: ["groq", "cloudflare"], configs, cooldown, signal: request.signal }), 200);
  } catch (err) {
    if (err instanceof AssistUnreadableError) return json({ error: "unreadable" }, 502);
    if (err instanceof AllProvidersFailedError) return json({ error: "unavailable" }, 503);
    throw err;
  }
}
