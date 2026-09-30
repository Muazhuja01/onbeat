import { SAMPLE_RATE } from "./audio";
import { encodeWav } from "./wav";

export interface CloudCaptionOptions {
  /** Read at every turn, so turning the setting off takes effect at once. */
  enabled: () => boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** How long a turn waits for the cloud before the in-browser text is used. */
  timeoutMs?: number;
  /** After a failure, turns skip the cloud for this long instead of each paying the wait. */
  cooldownMs?: number;
}

/**
 * Sends each finished turn to /api/transcribe (Deepgram Nova-3) and returns its
 * text, or null so the in-browser caption is kept: when the setting is off, the
 * service fails, is rate-limited or doesn't answer in time.
 */
export function createCloudCaptions(opts: CloudCaptionOptions): (audio: Float32Array) => Promise<string | null> {
  const fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 2500;
  const cooldownMs = opts.cooldownMs ?? 60_000;
  let resumeAt = 0;

  return async (audio) => {
    if (!opts.enabled() || now() < resumeAt) return null;
    try {
      const res = await fetchImpl("/api/transcribe", {
        method: "POST",
        headers: { "content-type": "audio/wav" },
        body: encodeWav(audio, SAMPLE_RATE) as BodyInit,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`transcribe ${res.status}`);
      const { text } = (await res.json()) as { text?: unknown };
      return typeof text === "string" ? text.trim() : null;
    } catch {
      resumeAt = now() + cooldownMs;
      return null;
    }
  };
}
