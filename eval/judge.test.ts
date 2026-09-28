// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { judge, judgeMessages, type JudgeInput } from "./judge";

const input: JudgeInput = {
  intended: "Large, please.",
  partnerSaid: "What size?",
  typed: "",
  contextLine: "It is Tuesday morning.",
  notes: ["Sam is the barista."],
  candidates: ["Large, please.", "Small."],
};

describe("judge", () => {
  it("numbers the candidates and lists the allowed facts", () => {
    const [, user] = judgeMessages(input);
    expect(user.content).toContain("1. Large, please.\n2. Small.");
    expect(user.content).toContain("- Sam is the barista.");
  });

  it("asks again without JSON mode when the model rejects it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad", { status: 400 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"match": 1, "invented": []}' } }] }));
    const text = await judge(input, { apiKey: "k", model: "openai/gpt-oss-120b", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(text).toContain('"match": 1');
    const bodies = fetchImpl.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(bodies[0].response_format).toEqual({ type: "json_object" });
    expect(bodies[1].response_format).toBeUndefined();
    expect(bodies[0].reasoning_effort).toBe("low");
  });

  it("waits and tries once more after a 429", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "{}" } }] }));
    const sleep = vi.fn(async () => {});
    await judge(input, { apiKey: "k", model: "openai/gpt-oss-120b", fetchImpl: fetchImpl as unknown as typeof fetch, sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
