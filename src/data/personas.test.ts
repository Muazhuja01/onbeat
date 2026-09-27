import { describe, expect, it } from "vitest";
import { personas } from "./personas";

describe("personas", () => {
  it("has the three example people", () => {
    expect(personas.map((p) => p.id)).toEqual(["maya", "tom", "aisha"]);
  });

  for (const p of personas) {
    describe(p.name, () => {
      const ids = new Set(p.notes.map((n) => n.id));
      it("has unique note and phrase ids", () => {
        expect(ids.size).toBe(p.notes.length);
        expect(new Set(p.phrases.map((x) => x.id)).size).toBe(p.phrases.length);
      });
      it("points defaults at a place and a person", () => {
        expect(p.notes.find((n) => n.id === p.defaultPlaceId)?.kind).toBe("place");
        expect(p.notes.find((n) => n.id === p.defaultPartnerId)?.kind).toBe("person");
      });
      it("only references existing notes from phrases", () => {
        for (const ph of p.phrases) {
          if (ph.context.placeId) expect(ids.has(ph.context.placeId)).toBe(true);
          if (ph.context.partnerId) expect(ids.has(ph.context.partnerId)).toBe(true);
        }
      });
      it("has no dash characters in visible text", () => {
        const text = [p.summary, ...p.notes.map((n) => n.text), ...p.phrases.map((x) => x.text)].join(" ");
        expect(text).not.toMatch(/[\u2013\u2014]/);
      });
    });
  }
});
