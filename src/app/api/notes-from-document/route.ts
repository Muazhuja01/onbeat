import { buildDocumentMessages, parseDocumentNotes } from "@/lib/profiles/document-notes";
import { DOCUMENT_MAX_BYTES, DOCUMENT_MAX_CHARS, documentKind, extractDocumentText } from "@/lib/server/document-text";
import { AllProvidersFailedError, createCooldown, providerConfigs, streamCompletion } from "@/lib/server/providers";
import { clientIp, isSameOrigin, json } from "@/lib/server/guard";
import { createRateLimiter } from "@/lib/server/rate-limit";

const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
const cooldown = createCooldown();

/** Turns an uploaded document into draft notes. The user confirms each one; nothing is stored here. */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!limiter.check(clientIp(request))) return json({ error: "rate_limited" }, 429);

  // Refuse an oversized upload before reading it into memory.
  if (Number(request.headers.get("content-length")) > DOCUMENT_MAX_BYTES + 64_000) return json({ error: "too_large" }, 413);
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (!(file instanceof File)) return json({ error: "invalid_request" }, 400);
  if (file.size > DOCUMENT_MAX_BYTES) return json({ error: "too_large" }, 413);
  if (!documentKind(file.name)) return json({ error: "unsupported" }, 415);

  let text: string;
  try {
    text = await extractDocumentText(file.name, new Uint8Array(await file.arrayBuffer()));
  } catch {
    // A damaged file reads the same as one with no text: either way there is nothing to use.
    return json({ error: "no_text" }, 422);
  }
  if (!text) return json({ error: "no_text" }, 422);
  const truncated = text.length > DOCUMENT_MAX_CHARS;

  try {
    const { deltas } = await streamCompletion(buildDocumentMessages(text.slice(0, DOCUMENT_MAX_CHARS)), {
      order: ["groq", "cloudflare"],
      configs: providerConfigs(),
      cooldown,
      signal: request.signal,
      maxTokens: 4000,
      temperature: 0.2,
      // A long document takes longer to read than a reply request.
      firstTokenTimeoutMs: 15_000,
      idleTimeoutMs: 15_000,
    });
    let output = "";
    try {
      for await (const delta of deltas) output += delta;
    } catch {
      // The provider stopped partway; a half list of notes would look complete, so start over.
      return json({ error: "unavailable" }, 503);
    }
    // Document content is never logged.
    return json({ notes: parseDocumentNotes(output), truncated }, 200);
  } catch (err) {
    if (err instanceof AllProvidersFailedError) return json({ error: "unavailable" }, 503);
    throw err;
  }
}
