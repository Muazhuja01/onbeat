import { describe, expect, it } from "vitest";
import { personas } from "@/data/personas";
import { assistCases } from "./cases";
import { statesTerm } from "./score";

describe("assistCases", () => {
  it("has 80 cases, 48 dev and 32 test, unique ids", () => {
    expect(assistCases).toHaveLength(80);
    expect(new Set(assistCases.map((c) => c.id)).size).toBe(80);
    const dev = assistCases.filter((c) => c.split === "dev");
    const test = assistCases.filter((c) => c.split === "test");
    expect(dev).toHaveLength(48);
    expect(test).toHaveLength(32);
    const job = (c: (typeof assistCases)[number]) => c.job ?? c.about.split(":")[0];
    for (const j of ["update", "prepare", "phrases"]) expect(dev.filter((c) => job(c) === j)).toHaveLength(16);
    expect(["update", "prepare", "phrases"].map((j) => test.filter((c) => job(c) === j).length)).toEqual([11, 11, 10]);
    for (const c of assistCases) if (c.job) expect(c.about.split(":")[0], c.id).toBe(c.job);
  });

  it("holds out at least 5 typed first messages and 5 cases that change nothing", () => {
    const test = assistCases.filter((c) => c.split === "test");
    expect(test.filter((c) => c.job === null).length).toBeGreaterThanOrEqual(5);
    expect(test.filter((c) => c.expected.length === 0).length).toBeGreaterThanOrEqual(5);
  });

  it("names only notes the persona has, and gives an opener when there is no job", () => {
    for (const c of assistCases) {
      const ids = new Set(personas.find((p) => p.id === c.persona)!.notes.map((n) => n.id));
      for (const e of c.expected) if (e.noteId) expect(ids.has(e.noteId), `${c.id} ${e.noteId}`).toBe(true);
      if (c.job === null) expect(c.opener, c.id).toBeTruthy();
    }
  });

  it("takes every brief-only term from the brief, and none from the notes", () => {
    for (const c of assistCases) {
      const notes = personas.find((p) => p.id === c.persona)!.notes.map((n) => n.text);
      const phrases = (c.quick ?? []).map(([text]) => text);
      for (const t of c.briefOnly) {
        expect(statesTerm(c.brief, t), `${c.id} "${t}" in brief`).toBe(true);
        expect([...notes, ...phrases].some((n) => statesTerm(n, t)), `${c.id} "${t}" in notes`).toBe(false);
      }
    }
  });
});
