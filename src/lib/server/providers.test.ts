// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AllProvidersFailedError, providerConfigs, streamCompletion } from "./providers";

const configs = providerConfigs({ GROQ_API_KEY: "g", CLOUDFLARE_API_TOKEN: "c", CLOUDFLARE_ACCOUNT_ID: "acc" } as unknown as NodeJS.ProcessEnv);
const messages = [{ role: "user" as const, content: "hi" }];

function sse(parts: string[], delayMs = 0): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(c) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      for (const p of parts) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

async function collect(gen: AsyncGenerator<string>) {
  let s = "";
  for await (const d of gen) s += d;
  return s;
}

describe("streamCompletion", () => {
  it("streams from the first provider", async () => {
    const fetchImpl = vi.fn(async () => sse(["Hel", "lo"]));
    const r = await streamCompletion(messages, { order: ["groq", "cloudflare"], configs, fetchImpl });
    expect(r.provider).toBe("groq");
    expect(await collect(r.deltas)).toBe("Hello");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("api.groq.com");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "qwen/qwen3.8-27b", stream: true, reasoning_effort: "none" });
  });

  it("falls back on HTTP 429", async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.includes("groq") ? new Response("busy", { status: 429 }) : sse(["ok"])));
    const r = await streamCompletion(messages, { order: ["groq", "cloudflare"], configs, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.provider).toBe("cloudflare");
    expect(await collect(r.deltas)).toBe("ok");
  });

  it("falls back when the first token is too slow", async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.includes("groq") ? sse(["late"], 200) : sse(["fast"])));
    const r = await streamCompletion(messages, { order: ["groq", "cloudflare"], configs, fetchImpl: fetchImpl as unknown as typeof fetch, firstTokenTimeoutMs: 50 });
    expect(r.provider).toBe("cloudflare");
  });

  it("skips providers without a key", async () => {
    const onlyCloudflare = providerConfigs({ CLOUDFLARE_API_TOKEN: "c", CLOUDFLARE_ACCOUNT_ID: "acc" } as unknown as NodeJS.ProcessEnv);
    const fetchImpl = vi.fn(async () => sse(["x"]));
    const r = await streamCompletion(messages, { order: ["groq", "cloudflare"], configs: onlyCloudflare, fetchImpl });
    expect(r.provider).toBe("cloudflare");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws when every provider fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    await expect(streamCompletion(messages, { order: ["groq", "cloudflare"], configs, fetchImpl })).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  it("stops calling further providers once the client disconnects", async () => {
    const clientController = new AbortController();
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes("groq")) {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            const onAbort = () => c.error(new DOMException("aborted", "AbortError"));
            if (init.signal?.aborted) onAbort();
            else init.signal?.addEventListener("abort", onAbort, { once: true });
            // Never enqueues content: the client disconnects before any token arrives.
          },
        });
        return new Response(body, { status: 200 });
      }
      return sse(["fast"]);
    });
    const resultPromise = streamCompletion(messages, {
      order: ["groq", "cloudflare"],
      configs,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: clientController.signal,
    });
    // Let the groq fetch start before the client goes away.
    await new Promise((r) => setTimeout(r, 10));
    clientController.abort();
    await expect(resultPromise).rejects.toBeInstanceOf(AllProvidersFailedError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
