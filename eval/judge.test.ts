// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { judge, judgeEndpoints, judgeMessages, JUDGE_MAX_TOKENS, JUDGE_PROMPT_VERSION, JUDGE_REASONING_EFFORT, type JudgeEndpoint, type JudgeInput } from "./judge";
import { judgeGold } from "./judge-gold";

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
  });

  it("states what is not a fact and what is, including contradictions", () => {
    const [, user] = judgeMessages(input);
    for (const s of [
      "These are not facts",
      "courtesy, greetings and thanks",
      "yes or no",
      "agreeing, accepting or declining",
      "saying something is fine or okay",
      "saying they will wait or will do what the other person asked or offered",
      "asking a question",
      "repeating what the other person said",
      "a direct answer to the other person's question that adds no specifics",
      "These are facts",
      "an event, activity, symptom, possession, place, name, number, day or time, a choice or preference, or a plan the other person did not raise",
      "contradicts",
      "choosing one of the options the other person gave",
      'its source is "partner", never "none"',
      "A question raising a topic does not back a specific answer to it",
      "Check every reply against the notes, even a plain answer",
    ])
      expect(user.content).toContain(s);
    expect(user.content).not.toContain("Politeness, yes or no");
    expect(user.content).not.toMatch(/[\u2013\u2014]/);
  });

  it("never quotes a gold reply, so the judge check measures the rules and not memorised answers", () => {
    const [, user] = judgeMessages({ ...input, candidates: [] });
    for (const g of judgeGold) for (const c of g.candidates) expect(user.content, `${g.id}: ${c}`).not.toContain(c);
  });

  it("lists saved phrases only when there are some", () => {
    expect(judgeMessages(input)[1].content).toContain("- My usual, please.");
    expect(judgeMessages({ ...input, phrases: [] })[1].content).not.toContain("Things the person has said before");
  });

  it("has a prompt version", () => {
    expect(JUDGE_PROMPT_VERSION).toBe(4);
  });
});

describe("judge", () => {
  it("returns the first endpoint's answer", async () => {
    const fetchImpl = vi.fn(async () => ok('{"match": 1, "replies": []}'));
    const out = await judge(input, { endpoints: [groq, cf], fetchImpl, sleep: noSleep });
    expect(out).toEqual({ text: '{"match": 1, "replies": []}', endpoint: "groq", model: "openai/gpt-oss-120b" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://groq.test");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "openai/gpt-oss-120b", temperature: 0, max_tokens: JUDGE_MAX_TOKENS, reasoning_effort: "low", response_format: { type: "json_object" } });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer g");
  });

  it("passes on the finish reason when the API gives one", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "length" }] }), { status: 200 }));
    const out = await judge(input, { endpoints: [groq], fetchImpl, sleep: noSleep });
    expect(out).toEqual({ text: "", endpoint: "groq", model: "openai/gpt-oss-120b", finishReason: "length" });
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
    const spent = new Set<string>();
    const out = await judge(input, { endpoints: [groq, cf], fetchImpl, sleep, spent });
    expect(out.endpoint).toBe("cloudflare");
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 2000);
    expect([...spent]).toEqual(["groq"]);
  });

  it("marks an endpoint spent on a long Retry-After and moves on without sleeping", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(status(429, { "retry-after": "3600" })).mockResolvedValueOnce(ok('{"match": 1, "replies": []}'));
    const sleep = vi.fn(noSleep);
    const spent = new Set<string>();
    const out = await judge(input, { endpoints: [groq, cf], fetchImpl, sleep, spent });
    expect(out.endpoint).toBe("cloudflare");
    expect(sleep).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect([...spent]).toEqual(["groq"]);
  });

  it("does not call an endpoint that is already spent", async () => {
    const fetchImpl = vi.fn(async () => ok('{"match": 1, "replies": []}'));
    const spent = new Set<string>(["groq"]);
    const out = await judge(input, { endpoints: [groq, cf], fetchImpl, sleep: noSleep, spent });
    expect(out.endpoint).toBe("cloudflare");
    const urls = fetchImpl.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls).toEqual(["https://cf.test"]);
  });

  it("names every endpoint as out of quota when all are spent", async () => {
    const fetchImpl = vi.fn(async () => ok("{}"));
    const spent = new Set<string>(["groq", "cloudflare"]);
    await expect(judge(input, { endpoints: [groq, cf], fetchImpl, sleep: noSleep, spent })).rejects.toThrow("judge failed: groq out of quota; cloudflare out of quota");
    expect(fetchImpl).not.toHaveBeenCalled();
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

  it("sends the same reasoning setting to both endpoints", () => {
    const [g, c] = judgeEndpoints({ GROQ_API_KEY: "g", CLOUDFLARE_ACCOUNT_ID: "acc", CLOUDFLARE_API_TOKEN: "c" } as unknown as NodeJS.ProcessEnv);
    expect(JUDGE_REASONING_EFFORT).toBe("high");
    expect(c.extraBody).toEqual({ reasoning_effort: JUDGE_REASONING_EFFORT });
    expect(g.extraBody).toEqual(c.extraBody);
  });
});
