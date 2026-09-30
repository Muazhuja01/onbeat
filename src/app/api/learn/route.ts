import { LearnRequestSchema } from "@/lib/learning/protocol";
import { learnFromBatch } from "@/lib/learning/server";
import { clientIp, isSameOrigin, json } from "@/lib/server/guard";
import { AllProvidersFailedError, createCooldown, providerConfigs } from "@/lib/server/providers";
import { createRateLimiter } from "@/lib/server/rate-limit";

/** 40 lines of 500 characters and 9 notes of 300 fit well under this. */
const BODY_MAX = 64_000;
// A browser sends a batch at most every few minutes; this leaves room for a few tabs.
const limiter = createRateLimiter({ limit: 6, windowMs: 60_000 });
const cooldown = createCooldown();

/**
 * Suggested notes: recent conversation lines and the notes they relate to go to the
 * model, which proposes new or changed notes. Nothing is stored here, and neither the
 * lines nor the notes are logged. The user confirms every proposal in the browser.
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
  const parsed = LearnRequestSchema.safeParse(data);
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const env = process.env;
  const configs = providerConfigs({ ...env, GROQ_MODEL: env.LEARN_MODEL ?? env.GROQ_MODEL });
  try {
    const proposals = await learnFromBatch(parsed.data, { order: ["groq", "cloudflare"], configs, cooldown, signal: request.signal });
    return json({ proposals }, 200);
  } catch (err) {
    if (err instanceof AllProvidersFailedError) return json({ error: "unavailable" }, 503);
    throw err;
  }
}
