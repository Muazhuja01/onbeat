// @vitest-environment node
import { describe, expect, it } from "vitest";
import { judgeGold } from "./judge-gold";
import { scenarios } from "./scenarios";
import { testScenarios } from "./test-scenarios";

describe("judgeGold", () => {
  it("has 20 entries, each a different dev scenario and never a test one", () => {
    expect(judgeGold).toHaveLength(20);
    const dev = new Set(scenarios.map((s) => s.id));
    const test = new Set(testScenarios.map((s) => s.id));
    for (const g of judgeGold) {
      expect(dev.has(g.id), g.id).toBe(true);
      expect(test.has(g.id), g.id).toBe(false);
    }
    expect(new Set(judgeGold.map((g) => g.id)).size).toBe(judgeGold.length);
  });

  it("numbers invented replies within range, once each, in order", () => {
    for (const g of judgeGold) {
      expect(g.candidates.length, g.id).toBeGreaterThan(0);
      for (const n of g.invented) {
        expect(Number.isInteger(n) && n >= 1 && n <= g.candidates.length, `${g.id}: ${n}`).toBe(true);
      }
      expect(g.invented, g.id).toEqual([...new Set(g.invented)].sort((a, b) => a - b));
      expect(g.why.length, g.id).toBeGreaterThan(0);
    }
  });

  it("has at least 6 entries with no invented reply", () => {
    expect(judgeGold.filter((g) => g.invented.length === 0).length).toBeGreaterThanOrEqual(6);
  });

  it("uses no en or em dashes", () => {
    expect(JSON.stringify(judgeGold)).not.toMatch(/[\u2013\u2014]/);
  });
});
