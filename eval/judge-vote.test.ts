// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { askVoted, judgementText, votedBy, voteJudgements } from "./judge-vote";
import { parseJudgement, type Judgement } from "./score";

const j = (match: number, invented: number[], facts: [number, string][] = []): Judgement => ({ match, invented, unbacked: facts.map(([n, fact]) => ({ n, fact })) });

describe("voteJudgements", () => {
  it("flags a reply when at least 2 of 3 calls flag it", () => {
    const v = voteJudgements([j(1, [1, 3], [[1, "a muffin"], [3, "a bag"]]), j(1, [3], [[3, "has a bag"]]), j(2, [2])]);
    expect(v).toEqual({ match: 1, invented: [3], unbacked: [{ n: 3, fact: "a bag" }, { n: 3, fact: "has a bag" }] });
  });

  it("takes the majority match, or the first call's when all three differ", () => {
    expect(voteJudgements([j(0, []), j(2, []), j(2, [])])!.match).toBe(2);
    expect(voteJudgements([j(3, []), j(1, []), j(2, [])])!.match).toBe(3);
  });

  it("counts an unreadable call as flagging nothing, and gives up without a possible majority", () => {
    expect(voteJudgements([j(1, [2]), null, j(1, [2])])).toMatchObject({ invented: [2] });
    expect(voteJudgements([j(1, [2]), null, j(1, [])])).toMatchObject({ invented: [] });
    expect(voteJudgements([j(1, [2]), null, null])).toBeNull();
  });

  it("drops repeated facts", () => {
    expect(voteJudgements([j(1, [1], [[1, "Has a bag"]]), j(1, [1], [[1, "has a bag "]]), j(1, [])])!.unbacked).toEqual([{ n: 1, fact: "Has a bag" }]);
  });
});

describe("judgementText", () => {
  it("reads back through parseJudgement unchanged", () => {
    const v = j(2, [1, 3], [[1, "a muffin"], [3, "a bag"]]);
    expect(parseJudgement(judgementText(v), 3)).toEqual(v);
    expect(parseJudgement(judgementText(j(0, [])), 3)).toEqual(j(0, []));
  });
});

describe("askVoted", () => {
  const parse = (text: string) => parseJudgement(text, 3);

  it("makes one plain call with one vote", async () => {
    const ask = vi.fn(async () => ({ text: '{"match": 1, "invented": [2]}', endpoint: "groq", model: "m" }));
    expect(await askVoted(ask, parse, 1)).toEqual({ text: '{"match": 1, "invented": [2]}', endpoint: "groq", model: "m" });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("asks three times and names every endpoint that answered", async () => {
    const texts = ['{"match": 1, "invented": [2]}', '{"match": 1, "invented": [2, 3]}', '{"match": 0, "invented": []}'];
    const ends = ["groq", "groq", "cloudflare"];
    let i = 0;
    const ask = vi.fn(async () => ({ text: texts[i], endpoint: ends[i++], model: "m" }));
    const out = await askVoted(ask, parse, 3);
    expect(ask).toHaveBeenCalledTimes(3);
    expect(out.endpoint).toBe("groq x2+cloudflare x1");
    expect(parse(out.text)).toEqual({ match: 1, invented: [2], unbacked: [] });
  });

  const good = { text: '{"match": 1, "invented": []}', endpoint: "groq", model: "m" };
  const empty = { text: "", endpoint: "groq", model: "m", finishReason: "length" };

  it("asks again once when an answer is unreadable, and uses the retry", async () => {
    const ask = vi.fn().mockResolvedValueOnce(empty).mockResolvedValue(good);
    const out = await askVoted(ask, parse, 3);
    expect(ask).toHaveBeenCalledTimes(4);
    expect(parse(out.text)).toEqual({ match: 1, invented: [], unbacked: [] });
    expect(out.note).toBeUndefined();
  });

  it("still judges when 2 of 3 votes are readable after retries", async () => {
    const ask = vi.fn().mockResolvedValueOnce(good).mockResolvedValueOnce(good).mockResolvedValue(empty);
    const out = await askVoted(ask, parse, 3);
    expect(ask).toHaveBeenCalledTimes(4);
    expect(parse(out.text)).not.toBeNull();
  });

  it("gives an empty answer with a reason when only 1 of 3 votes is readable", async () => {
    const ask = vi.fn().mockResolvedValueOnce(good).mockResolvedValue(empty);
    const out = await askVoted(ask, parse, 3);
    expect(ask).toHaveBeenCalledTimes(5);
    expect(out.text).toBe("");
    expect(out.note).toBe("judge answer unreadable after a retry (1 of 3 votes readable; unreadable: empty, finish_reason length; empty, finish_reason length)");
  });

  it("does not retry with one vote", async () => {
    const ask = vi.fn(async () => empty);
    await askVoted(ask, parse, 1);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("passes on a failed call", async () => {
    const ask = vi.fn().mockResolvedValueOnce({ text: "{}", endpoint: "groq", model: "m" }).mockRejectedValueOnce(new Error("judge failed"));
    await expect(askVoted(ask, parse, 3)).rejects.toThrow("judge failed");
  });
});

describe("votedBy", () => {
  it("counts calls per endpoint", () => {
    expect(votedBy(["groq", "groq", "groq"])).toBe("groq x3");
  });
});
