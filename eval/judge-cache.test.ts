// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JUDGE_PROMPT_VERSION, judgeMessages, type JudgeInput } from "./judge";
import { JudgeCache, judgeWithCache } from "./judge-cache";
import { parseJudgement } from "./score";

const dirs: string[] = [];
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), "judge-cache-"));
  dirs.push(dir);
  return join(dir, "nested", "cache.json");
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const input: JudgeInput = {
  intended: "Large, please.",
  partnerSaid: "What size would you like?",
  typed: "",
  contextLine: "It is Tuesday morning.",
  notes: ["My usual order is a large oat milk latte."],
  phrases: ["My usual, please."],
  candidates: ["Large, please.", "Small today."],
};
const answer = { text: '{"match": 1, "replies": []}', endpoint: "groq", model: "m" };
const parse = (text: string) => parseJudgement(text, input.candidates.length);
const write = (file: string, content: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};

describe("JudgeCache", () => {
  it("keys on the whole prompt and the prompt version", () => {
    const key = (i: JudgeInput, version = 2) => JudgeCache.key({ messages: judgeMessages(i), version });
    const k = key(input);
    expect(key({ ...input })).toBe(k);
    expect(key({ ...input, candidates: ["Small today.", "Large, please."] })).not.toBe(k);
    expect(key({ ...input, intended: "Small, please." })).not.toBe(k);
    expect(key({ ...input, notes: ["My usual order is a small tea."] })).not.toBe(k);
    expect(key(input, 3)).not.toBe(k);
  });

  it("stores answers on disk and reads them back in a new instance", () => {
    const file = tempFile();
    const a = new JudgeCache(file);
    expect(a.get("k")).toBeUndefined();
    a.set("k", answer);
    expect(new JudgeCache(file).get("k")).toEqual(answer);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ k: answer });
  });

  it("starts empty when the file is missing, broken or in the old string format", () => {
    const missing = tempFile();
    expect(new JudgeCache(missing).get("k")).toBeUndefined();
    const broken = tempFile();
    write(broken, "{not json");
    expect(new JudgeCache(broken).get("k")).toBeUndefined();
    const old = tempFile();
    write(old, JSON.stringify({ k: '{"match": 1}', j: { text: "x" } }));
    const c = new JudgeCache(old);
    expect(c.get("k")).toBeUndefined();
    expect(c.get("j")).toBeUndefined();
  });
});

describe("judgeWithCache", () => {
  it("asks on a miss and caches a parseable answer, then serves it from the cache", async () => {
    const cache = new JudgeCache(tempFile());
    const ask = vi.fn(async () => answer);
    const first = await judgeWithCache(cache, input, JUDGE_PROMPT_VERSION, ask, parse);
    expect(first.judgedBy).toBe("groq");
    expect(first.judgement?.match).toBe(1);
    const second = await judgeWithCache(cache, input, JUDGE_PROMPT_VERSION, ask, parse);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(second.judgedBy).toBe("cache:groq");
    expect(second.judgement?.match).toBe(1);
  });

  it("keeps the endpoint that answered, even when it was the fallback", async () => {
    const cache = new JudgeCache(tempFile());
    await judgeWithCache(cache, input, JUDGE_PROMPT_VERSION, async () => ({ ...answer, endpoint: "cloudflare" }), parse);
    const again = await judgeWithCache(cache, input, JUDGE_PROMPT_VERSION, vi.fn(), parse);
    expect(again.judgedBy).toBe("cache:cloudflare");
  });

  it("does not cache an unparseable answer and reports no judge", async () => {
    const cache = new JudgeCache(tempFile());
    const ask = vi.fn(async () => ({ ...answer, text: "no json" }));
    const out = await judgeWithCache(cache, input, JUDGE_PROMPT_VERSION, ask, parse);
    expect(out).toEqual({ judgement: null });
    await judgeWithCache(cache, input, JUDGE_PROMPT_VERSION, ask, parse);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("still returns the judgement when the cache write throws", async () => {
    const cache = new JudgeCache(tempFile());
    vi.spyOn(cache, "set").mockImplementation(() => {
      throw new Error("disk full");
    });
    const out = await judgeWithCache(cache, input, JUDGE_PROMPT_VERSION, async () => answer, parse);
    expect(out.judgement?.match).toBe(1);
    expect(out.judgedBy).toBe("groq");
  });
});
