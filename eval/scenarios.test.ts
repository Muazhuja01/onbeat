// @vitest-environment node
import { describe, expect, it } from "vitest";
import { personas } from "@/data/personas";
import { claimSupported, extractClaims } from "@/lib/suggest/validate";
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

describe("validator guard", () => {
  // Every reply a user really meant, and every saved phrase, must survive the claim
  // check when the profile's notes and the conversation are the sources. A failure
  // here means the check would hide a good reply: add the everyday word to
  // COMMON_WORDS (never a name).
  it("accepts every intended reply and saved phrase", () => {
    for (const s of [...scenarios, ...testScenarios]) {
      const p = personas.find((x) => x.id === s.persona)!;
      const source = [...p.notes.map((n) => n.text), s.partnerSaid, s.typed ?? "", "It is Tuesday morning."].join("\n");
      for (const claim of extractClaims(s.intended)) expect(claimSupported(claim, source), `${s.id}: ${claim}`).toBe(true);
    }
    for (const p of personas) {
      const source = p.notes.map((n) => n.text).join("\n");
      for (const ph of p.phrases) for (const claim of extractClaims(ph.text)) expect(claimSupported(claim, source), `${ph.id}: ${claim}`).toBe(true);
    }
  });
});
