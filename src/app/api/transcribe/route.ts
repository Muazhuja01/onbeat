import { clientIp, isSameOrigin, json } from "@/lib/server/guard";
import { createRateLimiter } from "@/lib/server/rate-limit";

/** A 30 s turn (the segmenter's longest) is about 960 KB as 16 kHz 16-bit WAV. */
const MAX_BYTES = 1_200_000;
const TIMEOUT_MS = 5000;
// A conversation ends a turn every few seconds at most; this leaves room for a fast talker.
const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

/**
 * Cloud captions: one finished turn of the other person's speech, as WAV, to
 * Deepgram Nova-3 on Cloudflare Workers AI. Only used when the user turns on
 * "Clearer captions". Audio and text are never stored or logged.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!limiter.check(clientIp(request))) return json({ error: "rate_limited" }, 429);
  if (Number(request.headers.get("content-length")) > MAX_BYTES) return json({ error: "too_large" }, 413);

  const audio = new Uint8Array(await request.arrayBuffer());
  if (audio.byteLength > MAX_BYTES) return json({ error: "too_large" }, 413);
  if (audio.byteLength < 44 || new TextDecoder().decode(audio.subarray(0, 4)) !== "RIFF") return json({ error: "invalid_request" }, 400);

  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) return json({ error: "unavailable" }, 503);

  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/deepgram/nova-3?smart_format=true&language=en`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "audio/wav" },
      body: audio,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Rate limits and quota ("daily free allocation") come back as 429; either way the browser keeps its own caption.
    if (!res.ok) return json({ error: "unavailable" }, 503);
    const body = (await res.json()) as { result?: { results?: { channels?: { alternatives?: { transcript?: string }[] }[] } } };
    const text = body.result?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
    return json({ text: text.trim() }, 200);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
