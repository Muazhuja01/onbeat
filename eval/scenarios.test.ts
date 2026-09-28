// @vitest-environment node
import { describe, expect, it } from "vitest";
import { personas } from "@/data/personas";
import { scenarios } from "./scenarios";

describe("eval scenarios", () => {
  it("has 20 per example profile, with unique ids", () => {
    for (const p of personas) expect(scenarios.filter((s) => s.persona === p.id)).toHaveLength(20);
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
  });

  it("only points at notes the profile has, with the right kinds", () => {
    for (const s of scenarios) {
      const notes = new Map(personas.find((p) => p.id === s.persona)!.notes.map((n) => [n.id, n]));
      for (const id of s.noteIds) expect(notes.has(id), `${s.id}: ${id}`).toBe(true);
      if (s.placeId) expect(notes.get(s.placeId)?.kind, s.id).toBe("place");
      if (s.partnerId) expect(notes.get(s.partnerId)?.kind, s.id).toBe("person");
    }
  });

  it("uses no en or em dashes", () => {
    expect(JSON.stringify(scenarios)).not.toMatch(/[\u2013\u2014]/);
  });
});
