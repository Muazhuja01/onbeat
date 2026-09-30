import { describe, expect, it } from "vitest";
import { personas } from "@/data/personas";
import { assistCases } from "./cases";

describe("assistCases", () => {
  it("has 48 cases, 16 per job, 32 dev and 16 test, unique ids", () => {
    expect(assistCases).toHaveLength(48);
    expect(new Set(assistCases.map((c) => c.id)).size).toBe(48);
    expect(assistCases.filter((c) => c.split === "test")).toHaveLength(16);
    const job = (c: (typeof assistCases)[number]) => c.job ?? c.about.split(":")[0];
    for (const j of ["update", "prepare", "phrases"]) expect(assistCases.filter((c) => job(c) === j)).toHaveLength(16);
  });

  it("names only notes the persona has, and gives an opener when there is no job", () => {
    for (const c of assistCases) {
      const ids = new Set(personas.find((p) => p.id === c.persona)!.notes.map((n) => n.id));
      for (const e of c.expected) if (e.noteId) expect(ids.has(e.noteId), `${c.id} ${e.noteId}`).toBe(true);
      if (c.job === null) expect(c.opener, c.id).toBeTruthy();
    }
  });
});
