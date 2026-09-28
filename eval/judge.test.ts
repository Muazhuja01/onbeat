// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { judge, judgeEndpoints, judgeMessages, JUDGE_PROMPT_VERSION, type JudgeEndpoint, type JudgeInput } from "./judge";

const input: JudgeInput = {
  intended: "Large, please.",
  partnerSaid: "What size would you like?",
  typed: "",
  contextLine: "It is Tuesday morning. Place: Blue Door Café. Talking with: Sam.",
  notes: ["My usual order is a large oat milk latte."],
  phrases: ["My usual, please."],
  candidates: ["Large, please.", "Small today."],
};

const groq: JudgeEndpoint = { name: "groq", url: "https://groq.test", apiKey: "g", model: "openai/gpt-oss-120b", extraBody: { reasoning_effort: "low" } };
const cf: JudgeEndpoint = { name: "cloudflare", url: "https://cf.test", apiKey: "c", model: "@cf/openai/gpt-oss-120b", extraBody: {} };

const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const status = (code: number, headers: Record<string, string> = {}) => new Response("{}", { status: code, headers });
const noSleep = async () => {};

describe("judgeMessages", () => {
  it("numbers the candidates and asks for facts with their sources", () => {
    const [, user] = judgeMessages(input);
    expect(user.content).toContain("1. Large, please.");
    expect(user.content).toContain("2. Small today.");
    for (const s of ['"note"', '"situation"', '"partner"', '"typed"', '"phrase"', '"none"', '"replies"']) expect(user.content).toContain(s);
    expect(user.content).toContain("are not facts");
  });

  it("lists saved phrases only when there are some", () => {
    expect(judgeMessages(input)[1].content).toContain("- My usual, please.");
    expect(judgeMessages({ ...input, phrases: [] })[1].content).not.toContain("Things the person has said before");
  });

  it("has a prompt version", () => {
    expect(JUDGE_PROMPT_VERSION).toBe(2);
  });
});

describe("judge", () => {
  it("returns the first endpoint's answer", async () => {
    const fetchImpl = vi.fn(async () => ok('{"match": 1, "replies": []}'));
    const out = await judge(input, { endpoints: [groq, cf], fetchImpl, sleep: noSleep });
    expect(out).toEqual({ text: '{"match": 1, "replies": []}', endpoint: "groq" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://groq.test");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "openai/gpt-oss-120b", temperature: 0, reasoning_effort: "low", response_format: { type: "json_object" } });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer g");
  });

  it("retries a 429 three times on one endpoint, then moves to the next", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(status(429, { "retry-after": "2" }))
      .mockResolvedValueOnce(status(429))
      .mockResolvedValueOnce(status(429))
      .mockResolvedValueOnce(status(429))
      .mockResolvedValueOnce(ok('{"match": 2, "replies": []}'));
    const sleep = vi.fn(noSleep);
    const out = await judge(input, { endpoints: [groq, cf], fetchImpl, sleep });
    expect(out.endpoint).toBe("cloudflare");
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 2000);
  });

  it("asks again without JSON mode when an endpoint rejects it", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(status(400)).mockResolvedValueOnce(ok('{"match": 0, "replies": []}'));
    const out = await judge(input, { endpoints: [cf], fetchImpl, sleep: noSleep });
    expect(out.endpoint).toBe("cloudflare");
    const second = JSON.parse((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(second.response_format).toBeUndefined();
  });

  it("moves on after a network error or a server error", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(ok('{"match": 1, "replies": []}'));
    expect((await judge(input, { endpoints: [groq, cf], fetchImpl, sleep: noSleep })).endpoint).toBe("cloudflare");
    const fetch500 = vi.fn().mockResolvedValueOnce(status(503)).mockResolvedValueOnce(ok('{"match": 1, "replies": []}'));
    expect((await judge(input, { endpoints: [groq, cf], fetchImpl: fetch500, sleep: noSleep })).endpoint).toBe("cloudflare");
  });

  it("throws with every endpoint's failure when all fail", async () => {
    const fetchImpl = vi.fn(async () => status(503));
    await expect(judge(input, { endpoints: [groq, cf], fetchImpl, sleep: noSleep })).rejects.toThrow("judge failed: groq HTTP 503; cloudflare HTTP 503");
  });

  it("throws when no endpoint is configured", async () => {
    await expect(judge(input, { endpoints: [], sleep: noSleep })).rejects.toThrow("no judge endpoint");
  });
});

describe("judgeEndpoints", () => {
  it("lists Groq then Cloudflare, each only with its keys", () => {
    const all = judgeEndpoints({ GROQ_API_KEY: "g", CLOUDFLARE_ACCOUNT_ID: "acc", CLOUDFLARE_API_TOKEN: "c" } as unknown as NodeJS.ProcessEnv);
    expect(all.map((e) => e.name)).toEqual(["groq", "cloudflare"]);
    expect(all[0]).toMatchObject({ model: "openai/gpt-oss-120b", apiKey: "g" });
    expect(all[1]).toMatchObject({ model: "@cf/openai/gpt-oss-120b", apiKey: "c", url: "https://api.cloudflare.com/client/v4/accounts/acc/ai/v1/chat/completions" });
    expect(judgeEndpoints({ GROQ_API_KEY: "g" } as unknown as NodeJS.ProcessEnv).map((e) => e.name)).toEqual(["groq"]);
    expect(judgeEndpoints({ GROQ_API_KEY: "g", EVAL_JUDGE_MODEL: "x", EVAL_JUDGE_CF_MODEL: "y", CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "c" } as unknown as NodeJS.ProcessEnv).map((e) => e.model)).toEqual(["x", "y"]);
  });
});
