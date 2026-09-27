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

export function providerConfigs(env: NodeJS.ProcessEnv = process.env): Record<ProviderId, ProviderConfig> {
  return {
    groq: {
      id: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: env.GROQ_MODEL ?? "qwen/qwen3.8-27b",
      apiKey: env.GROQ_API_KEY,
      extraBody: { reasoning_effort: "none" },
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

export interface StreamOptions {
  order: ProviderId[];
  configs: Record<ProviderId, ProviderConfig>;
  fetchImpl?: typeof fetch;
  firstTokenTimeoutMs?: number;
  signal?: AbortSignal;
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

async function* contentOnly(first: string, stream: AsyncGenerator<string>): AsyncGenerator<string> {
  yield first;
  for await (const data of stream) {
    const text = contentDelta(data);
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
      return { provider: id, deltas: contentOnly(first, stream) };
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
