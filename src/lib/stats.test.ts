import { describe, expect, it } from "vitest";
import { percentile } from "./stats";

describe("percentile", () => {
  it("uses the nearest rank", () => {
    expect(percentile([4, 1, 3, 2], 50)).toBe(2);
    expect(percentile([4, 1, 3, 2], 95)).toBe(4);
    expect(percentile([5], 50)).toBe(5);
    expect(percentile([], 50)).toBeNull();
  });
});
