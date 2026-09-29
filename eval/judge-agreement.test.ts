// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compareToGold, endpointAgreement } from "./judge-agreement";

const gold = [
  { id: "a", candidates: ["A1", "A2", "A3"], invented: [3] },
  { id: "b", candidates: ["B1", "B2"], invented: [] },
  { id: "c", candidates: ["C1", "C2"], invented: [1, 2] },
];

describe("compareToGold", () => {
  it("counts agreement, recall and false flags per reply", () => {
    const judged = new Map<string, number[] | null>([
      ["a", [2, 3]],
      ["b", []],
      ["c", [1]],
    ]);
    const r = compareToGold(gold, judged);
    expect(r).toMatchObject({ replies: 7, agree: 5, goldInvented: 3, caught: 2, falseFlags: 1, notJudged: [] });
    expect(r.disagreements).toEqual([
      { id: "a", n: 2, gold: false, judge: true, text: "A2" },
      { id: "c", n: 2, gold: true, judge: false, text: "C2" },
    ]);
  });

  it("leaves out entries the judge could not answer", () => {
    const judged = new Map<string, number[] | null>([
      ["a", [3]],
      ["b", null],
    ]);
    const r = compareToGold(gold, judged);
    expect(r).toMatchObject({ replies: 3, agree: 3, goldInvented: 1, caught: 1, falseFlags: 0, notJudged: ["b", "c"] });
    expect(r.disagreements).toEqual([]);
  });
});

describe("endpointAgreement", () => {
  it("compares only replies both endpoints judged", () => {
    const a = new Map<string, number[] | null>([
      ["a", [3]],
      ["b", []],
      ["c", [1, 2]],
    ]);
    const b = new Map<string, number[] | null>([
      ["a", [1, 3]],
      ["b", null],
      ["c", [1, 2]],
    ]);
    expect(endpointAgreement(gold, a, b)).toEqual({ replies: 5, agree: 4 });
  });
});
