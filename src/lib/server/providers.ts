import type { ChatMessage } from "@/lib/suggest/prompt";
import { contentDelta, readSSEData } from "./sse";

export type ProviderId = "groq" | "cloudflare";

export interface ProviderConfig {
  id: ProviderId;
  url: string;
  model: string;
  apiKey: string | undefined;
  /** Provider-specific request fields. */
  extraBody: Record<string, unknown>;
}

/**
 * Request fields that turn reasoning off, or as low as the model allows, so the
 * first token arrives quickly. gpt-oss models reject "none"; Qwen accepts it.
 */
export function groqExtraBody(model: string): Record<string, unknown> {
  return model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : { reasoning_effort: "none" };
}

export function providerConfigs(env: NodeJS.ProcessEnv = process.env): Record<ProviderId, ProviderConfig> {
  const groqModel = env.GROQ_MODEL ?? "qwen/qwen3.8-27b";
  return {
    groq: {
      id: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: groqModel,
      apiKey: env.GROQ_API_KEY,
      extraBody: groqExtraBody(groqModel),
    },
    cloudflare: {
      id: "cloudflare",
      url: `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID ?? ""}/ai/v1/chat/completions`,
      model: env.CLOUDFLARE_MODEL ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      // Without an account id the URL is unusable, so treat the provider as unconfigured.
      apiKey: env.CLOUDFLARE_ACCOUNT_ID ? env.CLOUDFLARE_API_TOKEN : undefined,
      // Qwen 3.8 on Workers AI can't switch its thinking off (reasoning_effort only accepts
      // xhigh/medium/low, never "none") and consistently misses the 1500 ms first-token
      // budget. Llama 3.3 70B (fast) answers in about 0.4-0.8 s with no extra body needed,
      // so it is the backup model. It occasionally truncates one of the 3 reply lines with
      // a dangling `"notes":` field (also happens with max_tokens raised to 600, confirmed
      // in the task report's live smoke test), so the backup can return fewer than 3 valid
      // replies; the client already drops invalid lines (Task 7/9) and the spec allows
      // showing fewer replies rather than filling the gap.
      extraBody: {},
    },
  };
}

export class AllProvidersFailedError extends Error {
  constructor(details: string) {
    super(`All providers failed: ${details}`);
    this.name = "AllProvidersFailedError";
  }
}

export interface ProviderCooldown {
  /** True while a provider that answered 429 should be skipped. */
  isCooling(id: ProviderId): boolean;
  block(id: ProviderId, ms: number): void;
}

export function createCooldown(now: () => number = Date.now): ProviderCooldown {
  const until = new Map<ProviderId, number>();
  return {
    isCooling: (id) => (until.get(id) ?? 0) > now(),
    block: (id, ms) => {
      until.set(id, Math.max(until.get(id) ?? 0, now() + ms));
    },
  };
}

/** How long to leave a provider alone after a 429: its Retry-After in seconds, 30 s if missing, at most 5 minutes. */
export function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  if (!header || !Number.isFinite(seconds) || seconds <= 0) return 30_000;
  return Math.min(seconds * 1000, 300_000);
}

export interface StreamOptions {
  order: ProviderId[];
  configs: Record<ProviderId, ProviderConfig>;
  fetchImpl?: typeof fetch;
  firstTokenTimeoutMs?: number;
  signal?: AbortSignal;
  /** Shared across requests, so a provider that said 429 is skipped until it recovers. */
  cooldown?: ProviderCooldown;
  /** Give up on a stream that goes quiet for this long after its first token. */
  idleTimeoutMs?: number;
}

async function firstContent(stream: AsyncGenerator<string>, deadline: number): Promise<string | null> {
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    const next = stream.next();
    next.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      next,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), remaining);
      }),
    ]);
    clearTimeout(timer);
    if (result === "timeout" || result.done) return null;
    const text = contentDelta(result.value);
    if (text) return text;
  }
}

async function* contentOnly(
  first: string,
  stream: AsyncGenerator<string>,
  idleMs: number,
  abort: () => void,
): AsyncGenerator<string> {
  yield first;
  while (true) {
    const next = stream.next();
    next.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      next,
      new Promise<"idle">((resolve) => {
        timer = setTimeout(() => resolve("idle"), idleMs);
      }),
    ]);
    clearTimeout(timer);
    if (result === "idle") {
      // Abort first so the pending read fails; never await return() on a stalled stream.
      abort();
      stream.return(undefined).catch(() => {});
      throw new Error(`provider stalled for ${idleMs} ms`);
    }
    if (result.done) return;
    const text = contentDelta(result.value);
    if (text) yield text;
  }
}

export async function streamCompletion(
  messages: ChatMessage[],
  opts: StreamOptions,
): Promise<{ provider: ProviderId; deltas: AsyncGenerator<string> }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.firstTokenTimeoutMs ?? 1500;
  const failures: string[] = [];

  for (const id of opts.order) {
    if (opts.signal?.aborted) throw new AllProvidersFailedError("client aborted");
    const cfg = opts.configs[id];
    if (!cfg.apiKey) {
      failures.push(`${id}: no key`);
      continue;
    }
    if (opts.cooldown?.isCooling(id)) {
      failures.push(`${id}: cooling down after 429`);
      continue;
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const deadline = Date.now() + timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(cfg.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          stream: true,
          temperature: 0.6,
          max_tokens: 400,
          ...cfg.extraBody,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        if (res.status === 429) opts.cooldown?.block(id, retryAfterMs(res.headers.get("retry-after")));
        opts.signal?.removeEventListener("abort", onAbort);
        failures.push(`${id}: HTTP ${res.status}`);
        controller.abort();
        continue;
      }
      const stream = readSSEData(res.body);
      const first = await firstContent(stream, deadline);
      if (first === null) {
        opts.signal?.removeEventListener("abort", onAbort);
        failures.push(`${id}: no first token in ${timeoutMs} ms`);
        // Abort first so the pending read fails; never await return() on a stalled stream.
        controller.abort();
        stream.return(undefined).catch(() => {});
        continue;
      }
      clearTimeout(timer);
      return { provider: id, deltas: contentOnly(first, stream, opts.idleTimeoutMs ?? 4000, () => controller.abort()) };
    } catch (err) {
      opts.signal?.removeEventListener("abort", onAbort);
      controller.abort();
      // A client disconnect aborts the in-flight provider request too, which surfaces here
      // as an AbortError. Stop instead of moving on to the next provider for a client that
      // has already left.
      if (opts.signal?.aborted) throw new AllProvidersFailedError("client aborted");
      failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new AllProvidersFailedError(failures.join("; "));
}
