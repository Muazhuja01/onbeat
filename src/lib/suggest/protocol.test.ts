import { describe, expect, it } from "vitest";
import { createLineSplitter, parseLine, parseLines, SuggestRequestSchema } from "./protocol";

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

describe("parseLines", () => {
  it("splits several JSON objects on one line", () => {
    expect(parseLines('{"reply": "Yes.", "notes": []}{"reply": "No.", "notes": []} {"reactions": ["ha"]}')).toEqual([
      { kind: "reply", text: "Yes.", noteIds: [] },
      { kind: "reply", text: "No.", noteIds: [] },
      { kind: "reactions", ids: ["ha"] },
    ]);
  });

  it("keeps braces inside strings", () => {
    const out = parseLines('{"reply": "Use {this} one.", "notes": []}{"reply": "Ok.", "notes": []}');
    expect(out.map((p) => p.kind)).toEqual(["reply", "reply"]);
    expect(out[0]).toEqual({ kind: "reply", text: "Use {this} one.", noteIds: [] });
  });

  it("drops text around the objects", () => {
    expect(parseLines('Here you go: {"reply": "Sure.", "notes": []}')).toEqual([{ kind: "reply", text: "Sure.", noteIds: [] }]);
  });

  it("reports a cut-off last object as invalid", () => {
    const out = parseLines('{"reply": "Yes.", "notes": []}{"reply": "No');
    expect(out[0]).toEqual({ kind: "reply", text: "Yes.", noteIds: [] });
    expect(out[1].kind).toBe("invalid");
  });

  it("behaves like parseLine for ordinary lines", () => {
    expect(parseLines("   ")).toEqual([]);
    expect(parseLines("```json")).toEqual([{ kind: "invalid", raw: "```json" }]);
    expect(parseLines('{"reply": "Hi.", "notes": []}')).toEqual([{ kind: "reply", text: "Hi.", noteIds: [] }]);
  });
});
