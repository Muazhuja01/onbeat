import { describe, expect, it } from "vitest";
import { contrastRatio, themes } from "./tokens";

describe("theme tokens", () => {
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });

  for (const [name, t] of Object.entries(themes)) {
    describe(name, () => {
      it("body text meets AAA on ground and surface", () => {
        expect(contrastRatio(t.ink, t.ground)).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(t.ink, t.surface)).toBeGreaterThanOrEqual(7);
      });
      it("secondary and partner text meet AA", () => {
        expect(contrastRatio(t.muted, t.ground)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.partner, t.ground)).toBeGreaterThanOrEqual(4.5);
      });
      it("text on a cue fill is readable", () => {
        expect(contrastRatio(t.onCue, t.cue)).toBeGreaterThanOrEqual(4.5);
      });
      it("the cue light is visible (fill or its ink border meets 3:1)", () => {
        const fill = contrastRatio(t.cue, t.ground);
        const border = contrastRatio(t.ink, t.ground);
        expect(Math.max(fill, border)).toBeGreaterThanOrEqual(3);
      });
    });
  }
});
