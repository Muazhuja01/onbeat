import { AllProvidersFailedError, createCooldown, providerConfigs, streamCompletion, type ProviderId } from "@/lib/server/providers";
import { checkReply } from "@/lib/server/claim-check";
import { filterReplies } from "@/lib/server/claim-filter";
import { clientIp, isSameOrigin, json } from "@/lib/server/guard";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { buildMessages } from "@/lib/suggest/prompt";
import { SuggestRequestSchema } from "@/lib/suggest/protocol";

const MAX_BODY_CHARS = 16_000;
const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
// Remembers which provider answered 429 so the next requests skip it until it recovers.
const cooldown = createCooldown();

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!limiter.check(clientIp(request))) return json({ error: "rate_limited" }, 429);

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return json({ error: "too_large" }, 413);

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const parsed = SuggestRequestSchema.safeParse(data);
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const order: ProviderId[] = parsed.data.preferProvider === "cloudflare" ? ["cloudflare", "groq"] : ["groq", "cloudflare"];

  try {
    const { provider, deltas } = await streamCompletion(buildMessages(parsed.data), {
      order,
      configs: providerConfigs(),
      cooldown,
      signal: request.signal,
    });
    const body = parsed.data;
    const output =
      process.env.CLAIM_CHECK === "on"
        ? filterReplies(deltas, (reply) =>
            checkReply(
              { reply, notes: body.notes.map((n) => n.text), partnerSaid: body.partnerSaid, typed: body.typed, contextLine: body.contextLine, phrases: body.examples },
              { apiKey: process.env.GROQ_API_KEY },
            ),
          )
        : deltas;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await output.next();
          if (done) controller.close();
          else controller.enqueue(encoder.encode(value));
        } catch (err) {
          // Surface a mid-stream provider failure as a stream error rather than a clean
          // end, so the client can tell a truncated reply from a complete one.
          controller.error(err);
        }
      },
      async cancel() {
        await output.return(undefined);
      },
    });
    // Request content is never logged.
    return new Response(stream, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-onbeat-provider": provider,
      },
    });
  } catch (err) {
    if (err instanceof AllProvidersFailedError) return json({ error: "unavailable" }, 503);
    throw err;
  }
}
