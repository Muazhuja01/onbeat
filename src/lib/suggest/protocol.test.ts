import { describe, expect, it } from "vitest";
import { createObjectSplitter, parseLine, parseObject, SuggestRequestSchema } from "./protocol";

describe("parseObject", () => {
  it("gives the same single result as parseLine for everything parseLine accepts", () => {
    for (const line of ['{"reply": "Large, please.", "notes": ["n1"]}', '{"reply": "Hi"}', '{"reactions": ["ha", "really"]}', "```json", '{"reply": ', '{"other": 1}']) {
      expect(parseObject(line)).toEqual([parseLine(line)]);
    }
    expect(parseObject("   ")).toEqual([]);
  });
  it("expands a wrapper of objects with text", () => {
    expect(parseObject('{"replies": [{"text": "One thing.", "notes": ["a"]}, {"text": "Another.", "notes": []}]}')).toEqual([
      { kind: "reply", text: "One thing.", noteIds: ["a"] },
      { kind: "reply", text: "Another.", noteIds: [] },
    ]);
  });
  it("expands a wrapper of objects with reply and defaults missing notes", () => {
    expect(parseObject('{"replies": [{"reply": "  Sure.  "}]}')).toEqual([{ kind: "reply", text: "Sure.", noteIds: [] }]);
  });
  it("expands a wrapper of plain strings and ignores a top-level notes array", () => {
    expect(parseObject('{"replies": ["First.", "Second."], "notes": ["n1"]}')).toEqual([
      { kind: "reply", text: "First.", noteIds: [] },
      { kind: "reply", text: "Second.", noteIds: [] },
    ]);
  });
  it("turns a bad item into an invalid entry and keeps the others", () => {
    const out = parseObject(`{"replies": ["Fine.", 5, {"text": ""}, {"text": "${"x".repeat(201)}"}, {"other": 1}]}`);
    expect(out.map((e) => e.kind)).toEqual(["reply", "invalid", "invalid", "invalid", "invalid"]);
  });
  it("adds a reactions entry after the replies", () => {
    expect(parseObject('{"replies": ["Yes."], "reactions": ["ha", "mm-hmm"]}')).toEqual([
      { kind: "reply", text: "Yes.", noteIds: [] },
      { kind: "reactions", ids: ["ha", "mm-hmm"] },
    ]);
  });
  it("rejects a wrapper with too many reactions", () => {
    expect(parseObject('{"replies": ["Yes."], "reactions": ["a", "b", "c", "d", "e"]}')[0].kind).toBe("invalid");
  });
  it("treats an empty replies list as invalid, or just the reactions if present", () => {
    expect(parseObject('{"replies": []}')).toEqual([{ kind: "invalid", raw: '{"replies": []}' }]);
    expect(parseObject('{"replies": [], "reactions": ["ha"]}')).toEqual([{ kind: "reactions", ids: ["ha"] }]);
  });
});

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

describe("createObjectSplitter", () => {
  const run = (chunks: string[]) => {
    const objects: string[] = [];
    const stray: string[] = [];
    const s = createObjectSplitter((o) => objects.push(o), (t) => stray.push(t));
    for (const c of chunks) s.push(c);
    s.flush();
    return { objects, stray, parsed: objects.map(parseLine) };
  };

  it("emits one object per line", () => {
    const { parsed } = run(['{"reply": "A", "notes": []}\n{"reply": "B", "notes": []}\n']);
    expect(parsed).toEqual([
      { kind: "reply", text: "A", noteIds: [] },
      { kind: "reply", text: "B", noteIds: [] },
    ]);
  });

  it("reads objects pretty-printed over several lines", () => {
    const text = '{\n  "reply": "Yes, my usual please.",\n  "notes": [\n    "m-usual"\n  ]\n}\n{\n  "reactions": [\n    "yes"\n  ]\n}';
    expect(run([text]).parsed).toEqual([
      { kind: "reply", text: "Yes, my usual please.", noteIds: ["m-usual"] },
      { kind: "reactions", ids: ["yes"] },
    ]);
  });

  it("ignores a markdown fence without calling it stray text", () => {
    const { parsed, stray } = run(['```json\n{"reply": "No, thank you.", "notes": []}\n```']);
    expect(parsed).toEqual([{ kind: "reply", text: "No, thank you.", noteIds: [] }]);
    expect(stray).toEqual([]);
  });

  it("splits several objects on one line", () => {
    const { parsed } = run(['{"reply": "Yes.", "notes": []}{"reply": "No.", "notes": []} {"reactions": ["ha"]}']);
    expect(parsed.map((p) => p?.kind)).toEqual(["reply", "reply", "reactions"]);
  });

  it("keeps braces and escaped quotes inside strings", () => {
    const { parsed } = run(['{"reply": "Use {this} \\"one\\".", "notes": []}{"reply": "Ok.", "notes": []}']);
    expect(parsed[0]).toEqual({ kind: "reply", text: 'Use {this} "one".', noteIds: [] });
    expect(parsed).toHaveLength(2);
  });

  it("gives the same result however the stream is cut", () => {
    const text = '```json\n{\n  "reply": "Say {hi} \\"now\\".",\n  "notes": ["a"]\n}\n{"reply": "B"}\n```';
    const whole = run([text]).objects;
    for (let i = 1; i < text.length; i++) {
      expect(run([text.slice(0, i), text.slice(i)]).objects, `cut at ${i}`).toEqual(whole);
    }
    expect(whole).toHaveLength(2);
  });

  it("reports text outside objects as stray, line by line", () => {
    const { parsed, stray } = run(['Here you go: {"reply": "Sure.", "notes": []}\nI cannot help with that.']);
    expect(parsed).toEqual([{ kind: "reply", text: "Sure.", noteIds: [] }]);
    expect(stray).toEqual(["Here you go:", "I cannot help with that."]);
  });

  it("emits a cut-off last object on flush so it counts as invalid", () => {
    const { parsed } = run(['{"reply": "Yes.", "notes": []}{"reply": "No']);
    expect(parsed[0]).toEqual({ kind: "reply", text: "Yes.", noteIds: [] });
    expect(parsed[1]?.kind).toBe("invalid");
  });

  it("emits nothing for blank input", () => {
    expect(run(["  \n\n"])).toEqual({ objects: [], stray: [], parsed: [] });
  });
});
