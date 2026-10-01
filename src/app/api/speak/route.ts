import { clientIp, isSameOrigin, json } from "@/lib/server/guard";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { VOICE_IDS } from "@/lib/voice/choices";

const MAX_TEXT = 300;
const SPEEDS = new Set([0.85, 1, 1.15]);
// A line on an awake server takes 1 to 2 s.
const TIMEOUT_MS = 25_000;
// A cold start with the GPU snapshot is about 11 s, 21 s at worst so far. A wake call that times
// out marks the voice down for a minute, so it gets more room than a line.
const WAKE_TIMEOUT_MS = 55_000;
export const maxDuration = 60;
// Three replies per turn of the other person plus what the user says.
const lines = createRateLimiter({ limit: 90, windowMs: 60_000 });
const wakes = createRateLimiter({ limit: 10, windowMs: 60_000 });

/**
 * Spoken lines: text to the Chatterbox voice server on Modal, which returns a WAV. The Modal
 * token stays on the server, so only OnBeat can spend the voice credit. Nothing is stored or logged.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, 403);
  const warm = new URL(request.url).searchParams.get("warm") === "1";
  if (!(warm ? wakes : lines).check(clientIp(request))) return json({ error: "rate_limited" }, 429);

  const base = process.env.MODAL_SPEAK_URL;
  const id = process.env.MODAL_TOKEN_ID;
  const secret = process.env.MODAL_TOKEN_SECRET;
  if (!base || !id || !secret) return json({ error: "unavailable" }, 503);
  const headers = { "Modal-Key": id, "Modal-Secret": secret, "content-type": "application/json" };

  if (warm) {
    try {
      const res = await fetch(`${base}/warm`, { method: "POST", headers, signal: AbortSignal.timeout(WAKE_TIMEOUT_MS) });
      return res.ok ? new Response(null, { status: 204, headers: { "cache-control": "no-store" } }) : json({ error: "unavailable" }, 503);
    } catch {
      return json({ error: "unavailable" }, 503);
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const { text, voice, speed } = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const line = typeof text === "string" ? text.trim() : "";
  if (!line || line.length > MAX_TEXT || typeof voice !== "string" || !VOICE_IDS.includes(voice) || typeof speed !== "number" || !SPEEDS.has(speed))
    return json({ error: "invalid_request" }, 400);

  try {
    // The browser gives up on a line after its own wait; stop waiting for it here too.
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]);
    const res = await fetch(`${base}/speak`, { method: "POST", headers, body: JSON.stringify({ text: line, voice, speed }), signal });
    if (!res.ok) return json({ error: "unavailable" }, 503);
    return new Response(await res.arrayBuffer(), { status: 200, headers: { "content-type": "audio/wav", "cache-control": "no-store" } });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
