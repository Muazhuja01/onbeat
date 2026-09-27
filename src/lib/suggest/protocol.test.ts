import { describe, expect, it } from "vitest";
import { createLineSplitter, parseLine, SuggestRequestSchema } from "./protocol";

describe("parseLine", () => {
  it("parses reply lines", () => {
    expect(parseLine('{"reply": "Large, please.", "notes": ["n1"]}')).toEqual({ kind: "reply", text: "Large, please.", noteIds: ["n1"] });
  });
  it("defaults missing notes to an empty list", () => {
    expect(parseLine('{"reply": "Hi"}')).toEqual({ kind: "reply", text: "Hi", noteIds: [] });
  });
  it("parses reactions", () => {
    expect(parseLine('{"reactions": ["ha", "really"]}')).toEqual({ kind: "reactions", ids: ["ha", "really"] });
  });
  it("ignores blank lines and flags junk", () => {
    expect(parseLine("   ")).toBeNull();
    expect(parseLine("```json")).toEqual({ kind: "invalid", raw: "```json" });
    expect(parseLine('{"reply": ')).toEqual({ kind: "invalid", raw: '{"reply":' });
    expect(parseLine('{"other": 1}')).toEqual({ kind: "invalid", raw: '{"other": 1}' });
  });
});

describe("createLineSplitter", () => {
  it("emits complete lines across chunk boundaries and flushes the rest", () => {
    const lines: string[] = [];
    const s = createLineSplitter((l) => lines.push(l));
    s.push('{"reply": "A"}\n{"re');
    s.push('ply": "B"}\n{"reply"');
    expect(lines).toEqual(['{"reply": "A"}', '{"reply": "B"}']);
    s.push(': "C"}');
    s.flush();
    expect(lines).toEqual(['{"reply": "A"}', '{"reply": "B"}', '{"reply": "C"}']);
  });
});

describe("SuggestRequestSchema", () => {
  const valid = {
    mode: "replies",
    typed: "",
    partnerSaid: "What size?",
    contextLine: "It is Tuesday morning.",
    notes: [{ id: "n1", text: "Note" }],
    examples: [],
    reactions: [{ id: "ha", text: "Ha!" }],
    maxWords: 15,
  };
  it("accepts a valid body", () => {
    expect(SuggestRequestSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects oversized fields", () => {
    expect(SuggestRequestSchema.safeParse({ ...valid, typed: "x".repeat(501) }).success).toBe(false);
    expect(SuggestRequestSchema.safeParse({ ...valid, notes: Array.from({ length: 13 }, (_, i) => ({ id: `n${i}`, text: "t" })) }).success).toBe(false);
  });
});
