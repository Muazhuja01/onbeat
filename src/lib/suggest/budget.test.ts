import { describe, expect, it } from "vitest";
import { RequestBudget } from "./budget";

function setup(capacity: number, perMinute = 60) {
  let t = 0;
  const budget = new RequestBudget({ capacity, perMinute, now: () => t });
  return { budget, advance: (ms: number) => void (t += ms) };
}

describe("RequestBudget", () => {
  it("lets requests through while tokens last", () => {
    const { budget } = setup(3);
    expect([budget.take("final"), budget.take("final"), budget.take("final")]).toEqual([0, 0, 0]);
    expect(budget.take("final")).toBeGreaterThan(0);
  });

  it("gives up speculative requests first, then typed ones", () => {
    const { budget } = setup(10);
    budget.take("final");
    budget.take("final"); // 8 left
    expect(budget.take("speculative")).toBe(0); // 7 left
    expect(budget.take("speculative")).toBeGreaterThan(0);
    expect(budget.take("typed")).toBe(0); // 6 left
    budget.take("final");
    budget.take("final");
    budget.take("final");
    budget.take("final"); // 2 left
    expect(budget.take("typed")).toBeGreaterThan(0);
    expect(budget.take("final")).toBe(0);
  });

  it("refills over time and says how long to wait", () => {
    const { budget, advance } = setup(1, 60);
    budget.take("final");
    expect(budget.take("final")).toBe(1000);
    advance(1000);
    expect(budget.take("final")).toBe(0);
  });

  it("empties when the server says it is rate limited", () => {
    const { budget } = setup(20);
    budget.drain();
    expect(budget.take("final")).toBeGreaterThan(0);
  });
});
