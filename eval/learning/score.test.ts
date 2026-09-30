import { describe, expect, it } from "vitest";
import { learningMarkdown, summarizeLearning, type LearnScenarioResult } from "./score";

const result = (over: Partial<LearnScenarioResult>): LearnScenarioResult => ({
  id: "x",
  model: "m",
  expected: [],
  shown: [],
  verdicts: [],
  ms: 1000,
  ...over,
});

describe("summarizeLearning", () => {
  it("counts precision, invented details, edit targeting and recall", () => {
    const s = summarizeLearning("m", [
      result({
        expected: [{ action: "edit", noteId: "physio", fact: "physio on Thursdays" }, { action: "add", fact: "Ana is the new carer" }],
        shown: [
          { action: "edit", noteId: "physio", text: "a" },
          { action: "add", text: "b" },
          { action: "add", text: "c" },
        ],
        verdicts: [
          { n: 1, keep: true, invented: [], matches: 1 },
          { n: 2, keep: true, invented: [], matches: 2 },
          { n: 3, keep: false, invented: ["4pm"], matches: null },
        ],
      }),
      result({ expected: [{ action: "edit", noteId: "sam", fact: "Sam moves" }], shown: [{ action: "add", text: "d" }], verdicts: [{ n: 1, keep: true, invented: [], matches: 1 }] }),
      result({ shown: [{ action: "add", text: "e" }], verdicts: null }),
      result({ error: "timeout", verdicts: null }),
    ]);
    expect(s).toMatchObject({ scenarios: 4, shown: 4, kept: 3, invented: 1, expected: 3, found: 3, edits: 2, editsRight: 1, unjudged: 1, errors: 1 });
  });

  it("writes a table with the targets", () => {
    const md = learningMarkdown([summarizeLearning("groq:qwen", [])]);
    expect(md).toContain("| Model |");
    expect(md).toContain("Worth keeping (target 80%)");
    expect(md).toContain("Invented (target under 5%)");
    expect(md).toContain("Edits right (target 90%)");
  });
});
