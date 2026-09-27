import { AllProvidersFailedError, providerConfigs, streamCompletion, type ProviderId } from "@/lib/server/providers";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { buildMessages } from "@/lib/suggest/prompt";
import { SuggestRequestSchema } from "@/lib/suggest/protocol";

const MAX_BODY_CHARS = 16_000;
const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

function json(data: unknown, status: number): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return json({ error: "forbidden" }, 403);

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!limiter.check(ip)) return json({ error: "rate_limited" }, 429);

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
      signal: request.signal,
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await deltas.next();
          if (done) controller.close();
          else controller.enqueue(encoder.encode(value));
        } catch {
          controller.close();
        }
      },
      async cancel() {
        await deltas.return(undefined);
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
