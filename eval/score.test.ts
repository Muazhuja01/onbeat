// @vitest-environment node
import { describe, expect, it } from "vitest";
import { judgedByPhrase, keystrokesSaved, parseJudgement, summarize, toMarkdown, type ScenarioResult } from "./score";

describe("parseJudgement", () => {
  it("reads match and marks replies with an unbacked fact as invented", () => {
    const text = JSON.stringify({
      match: 2,
      replies: [
        { n: 1, facts: [{ fact: "usual is an oat latte", source: "note" }] },
        { n: 2, facts: [] },
        { n: 3, facts: [{ fact: "went to the park", source: "none" }, { fact: "it is Tuesday", source: "situation" }] },
      ],
    });
    expect(parseJudgement(text, 3)).toEqual({ match: 2, invented: [3], unbacked: [{ n: 3, fact: "went to the park" }] });
  });

  it("treats source case and spacing loosely", () => {
    const text = '{"match": 0, "replies": [{"n": 1, "facts": [{"fact": "has a cat", "source": " None "}]}]}';
    expect(parseJudgement(text, 1)).toEqual({ match: 0, invented: [1], unbacked: [{ n: 1, fact: "has a cat" }] });
  });

  it("ignores reply numbers out of range", () => {
    const text = '{"match": 4, "replies": [{"n": 4, "facts": [{"fact": "x", "source": "none"}]}]}';
    expect(parseJudgement(text, 3)).toEqual({ match: 0, invented: [], unbacked: [] });
  });

  it("still reads an old-style invented list", () => {
    expect(parseJudgement('{"match": 1, "invented": [2, 2, 9]}', 3)).toEqual({ match: 1, invented: [2], unbacked: [] });
  });

  it("finds the object inside surrounding text and returns null when there is none", () => {
    expect(parseJudgement('Sure: {"match": 1, "replies": []} done', 2)).toEqual({ match: 1, invented: [], unbacked: [] });
    expect(parseJudgement("no json here", 2)).toBeNull();
    expect(parseJudgement("{broken", 2)).toBeNull();
  });
});

describe("keystrokesSaved", () => {
  it("counts one tap plus what was typed, against typing it all", () => {
    expect(keystrokesSaved("Large, please.", "", true)).toBeCloseTo(1 - 1 / 14);
    expect(keystrokesSaved("Large, please.", "lar", true)).toBeCloseTo(1 - 4 / 14);
    expect(keystrokesSaved("Large, please.", "lar", false)).toBe(0);
  });
});

describe("summarize", () => {
  it("rolls results up per model", () => {
    const base = { shown: ["a", "b"], rawReplies: 3, blocked: 1, keystrokesSaved: 0.5, noteRecall: true, firstReplyMs: 400, totalMs: 900 };
    const results: ScenarioResult[] = [
      { id: "1", ok: true, ...base, judgement: { match: 1, invented: [], unbacked: [] } },
      { id: "2", ok: true, ...base, noteRecall: false, judgement: { match: 0, invented: [2], unbacked: [{ n: 2, fact: "went to the park" }] }, keystrokesSaved: 0, firstReplyMs: 600, totalMs: 1100 },
      { id: "3", ok: false, error: "HTTP 503", shown: [], rawReplies: 0, blocked: 0, judgement: null, keystrokesSaved: 0, noteRecall: false, firstReplyMs: null, totalMs: null },
    ];
    expect(summarize("groq:m", results)).toMatchObject({
      scenarios: 3,
      failed: 1,
      judgeErrors: 0,
      hitRate: 0.5,
      inventedShown: 1,
      shownReplies: 4,
      empty: 0,
      judgedReplies: 4,
      blockedRate: 2 / 6,
      keystrokesSaved: 0.25,
      noteRecall: 0.5,
      firstReplyP50: 400,
      totalP95: 1100,
    });
  });
});

describe("toMarkdown", () => {
  it("makes one table row per model", () => {
    const md = toMarkdown([summarize("groq:m", [])]);
    expect(md.split("\n")).toHaveLength(3);
    expect(md).toContain("| groq:m | 0% |");
  });
});

describe("summarize: empty answers and judged replies", () => {
  const r = (over: Partial<ScenarioResult>): ScenarioResult => ({
    id: "x",
    ok: true,
    shown: ["a", "b"],
    rawReplies: 2,
    blocked: 0,
    judgement: { match: 1, invented: [], unbacked: [] },
    keystrokesSaved: 0.5,
    noteRecall: true,
    firstReplyMs: 100,
    totalMs: 200,
    ...over,
  });

  it("counts empty answers and divides invented details by judged replies only", () => {
    const s = summarize("m", [
      r({ judgement: { match: 1, invented: [2], unbacked: [{ n: 2, fact: "x" }] } }),
      r({ shown: [], rawReplies: 0, judgement: { match: 0, invented: [], unbacked: [] }, keystrokesSaved: 0 }),
      r({ shown: ["a", "b", "c"], judgement: null, keystrokesSaved: 0 }),
    ]);
    expect(s.empty).toBe(1);
    expect(s.judgedReplies).toBe(2);
    expect(s.inventedShown).toBe(1);
    expect(s.shownReplies).toBe(5);
    expect(s.judgeErrors).toBe(1);
    expect(s.keystrokesSaved).toBeCloseTo(0.25);
  });

  it("shows the invented rate, empty answers and unjudged scenarios in the table", () => {
    const s = summarize("m", [r({ judgement: { match: 1, invented: [2], unbacked: [] } }), r({ judgement: null })]);
    const md = toMarkdown([s]);
    expect(md).toContain("| Empty |");
    expect(md).toContain("| Not judged |");
    expect(md).toContain("1 of 2 (50%)");
  });
});

describe("judgedByPhrase", () => {
  const r = (judgedBy?: string): ScenarioResult => ({
    id: "x",
    ok: true,
    shown: [],
    rawReplies: 0,
    blocked: 0,
    judgement: null,
    keystrokesSaved: 0,
    noteRecall: true,
    firstReplyMs: null,
    totalMs: null,
    ...(judgedBy ? { judgedBy } : {}),
  });

  it("counts cache hits under the endpoint that answered and shows how many were cached", () => {
    const results = [r("cache:groq"), r("groq"), r("groq"), r(), r("cloudflare"), r("cache:cloudflare"), r("groq")];
    expect(judgedByPhrase(results)).toBe("groq (4, 1 cached), cloudflare (2, 1 cached)");
    expect(judgedByPhrase([r("groq"), r("cloudflare")])).toBe("groq (1), cloudflare (1)");
  });

  it("says so when nothing was judged", () => {
    expect(judgedByPhrase([r(), r()])).toBe("no judge");
  });
});

describe("summarize: claim check", () => {
  it("adds up replies the claim check dropped and shows them in the table", () => {
    const base: ScenarioResult = {
      id: "x", ok: true, shown: ["a"], rawReplies: 3, blocked: 0, judgement: { match: 1, invented: [], unbacked: [] },
      keystrokesSaved: 0, noteRecall: true, firstReplyMs: 1, totalMs: 1, checkBlocked: 2,
    };
    const s = summarize("m", [base, { ...base, checkBlocked: 1 }]);
    expect(s.checkBlocked).toBe(3);
    expect(toMarkdown([s])).toContain("| Dropped by the claim check |");
  });

  it("adds up replies the claim check could not decide on and shows them in the table", () => {
    const base: ScenarioResult = {
      id: "x", ok: true, shown: ["a"], rawReplies: 3, blocked: 0, judgement: { match: 1, invented: [], unbacked: [] },
      keystrokesSaved: 0, noteRecall: true, firstReplyMs: 1, totalMs: 1, checkUnknown: 2,
    };
    const s = summarize("m", [base, { ...base, checkUnknown: 1 }]);
    expect(s.checkUnknown).toBe(3);
    expect(toMarkdown([s])).toContain("| Claim check unsure |");
  });

  it("treats missing checkUnknown as 0 when summing", () => {
    const base: ScenarioResult = {
      id: "x", ok: true, shown: ["a"], rawReplies: 3, blocked: 0, judgement: { match: 1, invented: [], unbacked: [] },
      keystrokesSaved: 0, noteRecall: true, firstReplyMs: 1, totalMs: 1,
    };
    const s = summarize("m", [base, { ...base, checkUnknown: 1 }]);
    expect(s.checkUnknown).toBe(1);
  });
});
