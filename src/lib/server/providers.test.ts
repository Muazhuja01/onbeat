// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AllProvidersFailedError, createCooldown, groqExtraBody, providerConfigs, retryAfterMs, streamCompletion } from "./providers";

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

/** Sends one token, then never sends anything again. */
function stalling(first: string): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: first } }] })}\n\n`));
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

  it("skips a provider that is cooling down after a 429", async () => {
    const cooldown = createCooldown();
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("groq") ? new Response("busy", { status: 429, headers: { "retry-after": "20" } }) : sse(["ok"]),
    );
    const ask = () => streamCompletion(messages, { order: ["groq", "cloudflare"], configs, fetchImpl: fetchImpl as unknown as typeof fetch, cooldown });
    await ask();
    const r = await ask();
    expect(r.provider).toBe("cloudflare");
    expect(fetchImpl.mock.calls.filter(([u]) => String(u).includes("groq"))).toHaveLength(1);
  });

  it("fails a stream that stalls after the first token", async () => {
    const fetchImpl = vi.fn(async () => stalling("Hi"));
    const r = await streamCompletion(messages, { order: ["groq"], configs, fetchImpl, idleTimeoutMs: 50 });
    const got: string[] = [];
    await expect(
      (async () => {
        for await (const d of r.deltas) got.push(d);
      })(),
    ).rejects.toThrow(/stalled/);
    expect(got).toEqual(["Hi"]);
  });
});

describe("createCooldown", () => {
  it("blocks a provider until the time passes", () => {
    let t = 0;
    const c = createCooldown(() => t);
    c.block("groq", 1000);
    expect(c.isCooling("groq")).toBe(true);
    expect(c.isCooling("cloudflare")).toBe(false);
    t = 1001;
    expect(c.isCooling("groq")).toBe(false);
  });
});

describe("retryAfterMs", () => {
  it("reads seconds, defaults to 30 s and caps at 5 minutes", () => {
    expect(retryAfterMs("20")).toBe(20_000);
    expect(retryAfterMs(null)).toBe(30_000);
    expect(retryAfterMs("soon")).toBe(30_000);
    expect(retryAfterMs("9999")).toBe(300_000);
  });
});

describe("groqExtraBody", () => {
  it("turns reasoning off, or as low as the model allows", () => {
    expect(groqExtraBody("qwen/qwen3.8-27b")).toEqual({ reasoning_effort: "none" });
    expect(groqExtraBody("openai/gpt-oss-20b")).toEqual({ reasoning_effort: "low" });
    const env = { GROQ_API_KEY: "g", GROQ_MODEL: "openai/gpt-oss-20b" } as unknown as NodeJS.ProcessEnv;
    expect(providerConfigs(env).groq.extraBody).toEqual({ reasoning_effort: "low" });
  });
});
