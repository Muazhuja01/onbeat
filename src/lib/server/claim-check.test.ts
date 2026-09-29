// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { checkReply, claimCheckMaxTokens, claimCheckMessages, DEFAULT_CLAIM_CHECK_MODEL, type ClaimCheckInput } from "./claim-check";

const input: ClaimCheckInput = {
  reply: "I went to the park.",
  notes: ["Biscuit is my dog."],
  partnerSaid: "What did you do today?",
  typed: "",
  contextLine: "It is Tuesday morning.",
  phrases: ["My usual, please."],
};

const answer = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe("claimCheckMessages", () => {
  it("gives the reply, the sources and a one-word answer format", () => {
    const [, user] = claimCheckMessages(input);
    for (const s of ['"I went to the park."', "- Biscuit is my dog.", "What did you do today?", "- My usual, please.", "ok or invented"]) {
      expect(user.content).toContain(s);
    }
  });
});

describe("checkReply", () => {
  it("reads ok and invented", async () => {
    expect(await checkReply(input, { apiKey: "k", fetchImpl: vi.fn(async () => answer("invented")) })).toBe("invented");
    expect(await checkReply(input, { apiKey: "k", fetchImpl: vi.fn(async () => answer(" OK.")) })).toBe("ok");
  });

  it("sends a short deterministic request to the check model", async () => {
    const fetchImpl = vi.fn(async () => answer("ok"));
    await checkReply(input, { apiKey: "k", model: "m", fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "m", temperature: 0, max_tokens: 3, reasoning_effort: "none" });
  });

  it.each([
    ["qwen/qwen3.8-27b", "none", 3],
    ["openai/gpt-oss-20b", "low", 64],
  ])("sends the provider settings for %s", async (model, effort, maxTokens) => {
    const fetchImpl = vi.fn(async () => answer("ok"));
    await checkReply(input, { apiKey: "k", model, fetchImpl });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ model, reasoning_effort: effort, max_tokens: maxTokens });
    expect(claimCheckMaxTokens(model)).toBe(maxTokens);
  });

  it("uses the default model when none is given", async () => {
    const fetchImpl = vi.fn(async () => answer("ok"));
    await checkReply(input, { apiKey: "k", fetchImpl });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).model).toBe(DEFAULT_CLAIM_CHECK_MODEL);
    expect(DEFAULT_CLAIM_CHECK_MODEL).toBe("openai/gpt-oss-20b");
  });

  it("returns unknown on an unclear answer, an HTTP error, a network error or no key", async () => {
    expect(await checkReply(input, { apiKey: "k", fetchImpl: vi.fn(async () => answer("maybe")) })).toBe("unknown");
    expect(await checkReply(input, { apiKey: "k", fetchImpl: vi.fn(async () => new Response("{}", { status: 429 })) })).toBe("unknown");
    expect(await checkReply(input, { apiKey: "k", fetchImpl: vi.fn(async () => Promise.reject(new TypeError("fetch failed"))) })).toBe("unknown");
    expect(await checkReply(input, { apiKey: undefined, fetchImpl: vi.fn() })).toBe("unknown");
  });

  it("gives up after the timeout", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
      );
      const verdict = checkReply(input, { apiKey: "k", timeoutMs: 600, fetchImpl: fetchImpl as unknown as typeof fetch });
      await vi.advanceTimersByTimeAsync(600);
      expect(await verdict).toBe("unknown");
    } finally {
      vi.useRealTimers();
    }
  });
});
