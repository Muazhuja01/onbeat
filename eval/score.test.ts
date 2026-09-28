// @vitest-environment node
import { describe, expect, it } from "vitest";
import { keystrokesSaved, parseJudgement, summarize, toMarkdown, type ScenarioResult } from "./score";

describe("parseJudgement", () => {
  it("reads the judge's JSON, even with text around it", () => {
    expect(parseJudgement('Sure. {"match": 2, "invented": [3, 3]}', 3)).toEqual({ match: 2, invented: [3] });
  });

  it("ignores numbers outside the candidate list", () => {
    expect(parseJudgement('{"match": 5, "invented": [0, 2, 9]}', 3)).toEqual({ match: 0, invented: [2] });
  });

  it("returns null for an unreadable answer", () => {
    expect(parseJudgement("no idea", 3)).toBeNull();
    expect(parseJudgement("{broken", 3)).toBeNull();
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
      { id: "1", ok: true, ...base, judgement: { match: 1, invented: [] } },
      { id: "2", ok: true, ...base, noteRecall: false, judgement: { match: 0, invented: [2] }, keystrokesSaved: 0, firstReplyMs: 600, totalMs: 1100 },
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
