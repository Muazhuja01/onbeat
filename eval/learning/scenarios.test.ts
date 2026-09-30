import { describe, expect, it } from "vitest";
import { personas } from "@/data/personas";
import { learnScenarios } from "./scenarios";

describe("learning scenarios", () => {
  it("have unique ids and point at real persona notes", () => {
    expect(new Set(learnScenarios.map((s) => s.id)).size).toBe(learnScenarios.length);
    for (const s of learnScenarios) {
      const ids = new Set(personas.find((p) => p.id === s.persona)!.notes.map((n) => n.id));
      for (const id of [s.partnerId, s.placeId, ...s.expected.map((e) => e.noteId)]) if (id) expect(ids.has(id), `${s.id}: ${id}`).toBe(true);
      for (const e of s.expected) expect(e.action === "edit", `${s.id}: an edit names its note`).toBe(Boolean(e.noteId));
      expect(s.lines.length, s.id).toBeGreaterThanOrEqual(2);
    }
  });
});
