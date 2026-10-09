import { describe, expect, it } from "vitest";
import { screenCard, textArea, textField } from "./ui";

describe("shared styles", () => {
  it("outlines text fields in a colour that meets 3:1 against them", () => {
    // `muted` is checked at 4.5:1 or better on `raised` and `surface` in tokens.test.ts; a faded ink isn't.
    for (const field of [textField, textArea]) {
      expect(field).toContain("border-muted");
      expect(field).toContain("bg-raised");
    }
  });

  it("lifts each screen onto a card", () => {
    expect(screenCard).toContain("shadow-tray");
    expect(screenCard).toContain("bg-surface");
  });
});
