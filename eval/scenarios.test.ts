// @vitest-environment node
import { describe, expect, it } from "vitest";
import { personas } from "@/data/personas";
import { scenarios, type Scenario } from "./scenarios";
import { testScenarios } from "./test-scenarios";

const sets: [string, Scenario[]][] = [
  ["dev", scenarios],
  ["test", testScenarios],
];

describe.each(sets)("%s scenarios", (_name, list) => {
  it("has 20 per example profile, with unique ids", () => {
    for (const p of personas) expect(list.filter((s) => s.persona === p.id)).toHaveLength(20);
    expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
  });

  it("only points at notes the profile has, with the right kinds", () => {
    for (const s of list) {
      const notes = new Map(personas.find((p) => p.id === s.persona)!.notes.map((n) => [n.id, n]));
      for (const id of s.noteIds) expect(notes.has(id), `${s.id}: ${id}`).toBe(true);
      if (s.placeId) expect(notes.get(s.placeId)?.kind, s.id).toBe("place");
      if (s.partnerId) expect(notes.get(s.partnerId)?.kind, s.id).toBe("person");
    }
  });

  it("uses no en or em dashes", () => {
    expect(JSON.stringify(list)).not.toMatch(/[\u2013\u2014]/);
  });

  it("has typed letters in about a fifth of the scenarios", () => {
    const typed = list.filter((s) => s.typed).length;
    expect(typed).toBeGreaterThanOrEqual(9);
    expect(typed).toBeLessThanOrEqual(15);
  });
});

describe("test set", () => {
  it("shares no ids and no partner lines with the dev set", () => {
    const devIds = new Set(scenarios.map((s) => s.id));
    const devLines = new Set(scenarios.map((s) => s.partnerSaid));
    for (const s of testScenarios) {
      expect(devIds.has(s.id), s.id).toBe(false);
      expect(devLines.has(s.partnerSaid), s.id).toBe(false);
    }
  });

  it("marks its ids with t", () => {
    for (const s of testScenarios) expect(s.id).toMatch(/^(maya|tom|aisha)-t\d{2}$/);
  });
});
