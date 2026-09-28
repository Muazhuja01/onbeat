import { describe, expect, it } from "vitest";
import { en } from "@/lib/language-packs/en";
import { MemoryStore } from "@/lib/memory/store";
import type { Note } from "@/lib/types";
import { buildSuggestRequest, clampInput } from "./request";

const NOTES: Note[] = [
  { id: "cafe", kind: "place", text: "Blue Door Café is my local coffee shop.", entities: ["Blue Door Café"], updatedAt: 0 },
  { id: "sam", kind: "person", text: "Sam is the barista at Blue Door Café.", entities: ["Sam", "Blue Door Café"], updatedAt: 0 },
];

describe("clampInput", () => {
  it("keeps the start of the typed text and the end of what the partner said", () => {
    const out = clampInput({ typed: "a".repeat(600), partnerSaid: `${"x".repeat(1000)}END` });
    expect(out.typed).toHaveLength(500);
    expect(out.partnerSaid).toHaveLength(1000);
    expect(out.partnerSaid.endsWith("END")).toBe(true);
  });
});

describe("buildSuggestRequest", () => {
  it("builds the body and the validation sources from memory", async () => {
    const memory = await MemoryStore.create();
    await memory.replaceAll(NOTES, []);
    const { body, sources } = await buildSuggestRequest({
      memory,
      pack: en,
      input: { mode: "replies", typed: "my usual", partnerSaid: "Hi", context: { now: new Date(2026, 8, 29, 8), partnerId: "sam" } },
      simple: true,
    });
    expect(body.maxWords).toBe(en.simpleMaxWords);
    expect(body.contextLine).toContain("Talking with: Sam.");
    expect(body.notes.length).toBeLessThanOrEqual(8);
    expect(sources.context).toBe(body.contextLine);
    expect(sources.typed).toBe("my usual");
    expect([...sources.notes.keys()]).toEqual(body.notes.map((n) => n.id));
  });
});
