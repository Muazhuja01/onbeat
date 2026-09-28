import type { ProviderCooldown, ProviderId } from "@/lib/server/providers";

export interface RecordingCooldown extends ProviderCooldown {
  /** The last ms a 429 asked to wait. Null until one arrives. */
  lastBlockedMs: number | null;
}

/**
 * A cooldown that never reports cooling, so the single provider an eval scenario is
 * testing is always tried, but remembers the last 429 wait it recorded so the caller
 * can decide how long to sleep before the next attempt.
 */
export function createRecordingCooldown(): RecordingCooldown {
  const cooldown: RecordingCooldown = {
    lastBlockedMs: null,
    isCooling: () => false,
    block: (_id: ProviderId, ms: number) => {
      cooldown.lastBlockedMs = ms;
    },
  };
  return cooldown;
}

export interface RetryOptions {
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  log?: (line: string) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `attempt` with a fresh recording cooldown, retrying the failures a Groq free-tier
 * eval run hits in practice instead of counting them as a failed scenario:
 *   - a 429 (the cooldown recorded a wait): sleep min(recorded ms, 60 s) and try again;
 *   - a network error ("fetch failed"): sleep 5 s and try again, at most once total;
 *   - anything else (a first-token or idle timeout, an abort, a non-429 HTTP status):
 *     rethrow without retrying.
 * At most `maxAttempts` attempts run in total; the last error is rethrown after the final one.
 */
export async function withRetry<T>(id: string, attempt: (cooldown: ProviderCooldown) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const maxAttempts = opts.maxAttempts ?? 4;
  const log = opts.log ?? ((line: string) => console.log(line));
  let networkRetried = false;

  for (let n = 1; n <= maxAttempts; n++) {
    const cooldown = createRecordingCooldown();
    try {
      return await attempt(cooldown);
    } catch (err) {
      if (n === maxAttempts) throw err;
      if (cooldown.lastBlockedMs !== null) {
        const waitMs = Math.min(cooldown.lastBlockedMs, 60_000);
        log(`  ${id}: rate limited, retrying in ${Math.round(waitMs / 1000)} s (attempt ${n + 1} of ${maxAttempts})`);
        await sleep(waitMs);
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("fetch failed") && !networkRetried) {
        networkRetried = true;
        log(`  ${id}: network error, retrying in 5 s (attempt ${n + 1} of ${maxAttempts})`);
        await sleep(5_000);
        continue;
      }
      throw err;
    }
  }
  // Unreachable: every path above returns or throws.
  throw new Error("withRetry: unreachable");
}
