// @vitest-environment node
import { describe, expect, it } from "vitest";
import { scenarioJudgeInput, scenarioRequest } from "./judge-input";
import { scenarios } from "./scenarios";

const byId = (id: string) => scenarios.find((s) => s.id === id)!;

describe("scenarioJudgeInput", () => {
  it("builds what the judge sees from the scenario's request, without generating replies", async () => {
    const sc = byId("tom-19");
    const j = await scenarioJudgeInput(sc);
    expect(j).toMatchObject({ intended: sc.intended, partnerSaid: sc.partnerSaid, typed: "", contextLine: "It is Tuesday morning. Talking with: Dr. Chen." });
    expect(j.notes).toContain("Dr. Chen at Lakeview Clinic is my family doctor.");
    expect(j.phrases).toHaveLength(5);
    expect(j).not.toHaveProperty("candidates");
  });

  it("matches the request body run.ts sends", async () => {
    const sc = byId("maya-02");
    const { body, judgeInput } = await scenarioRequest(sc);
    expect(judgeInput.typed).toBe("lar");
    expect(judgeInput.contextLine).toBe(body.contextLine);
    expect(judgeInput.notes).toEqual(body.notes.map((n) => n.text));
    expect(judgeInput.phrases).toEqual(body.examples);
  });

  it("is the same every time for the same scenario", async () => {
    for (const id of ["maya-05", "tom-11", "aisha-15"]) {
      expect(await scenarioJudgeInput(byId(id))).toEqual(await scenarioJudgeInput(byId(id)));
    }
  });
});
