// @vitest-environment node
import { describe, expect, it } from "vitest";
import { keystrokesSaved, parseJudgement, summarize, toMarkdown, type ScenarioResult } from "./score";

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
