import { describe, expect, it } from "vitest";
import { buildAssistMessages, clipSay, parseAssistOutput } from "./prompt";

describe("parseAssistOutput", () => {
  it("reads a pretty-printed object across lines, with a think block and a code fence around it", () => {
    const out = `<think>ok</think>\n\`\`\`json\n{\n  "say": "When is it?",\n  "proposals": [\n    {"action": "phrase", "text": "Can we go over my dose?", "for": "Dr. Chen", "lines": ["U1"]}\n  ]\n}\n\`\`\``;
    expect(parseAssistOutput(out)).toEqual({
      say: "When is it?",
      proposals: [{ action: "phrase", text: "Can we go over my dose?", for: "Dr. Chen", lines: ["U1"] }],
    });
  });

  it("skips malformed proposals and keeps the rest", () => {
    const out = JSON.stringify({
      say: "Here you go.",
      proposals: [
        { action: "add", kind: "person", name: "Ana", text: "Ana is my carer.", lines: ["U1"] },
        { action: "add", kind: "robot", text: "x", lines: ["U1"] },
        { action: "edit", kind: "routine", text: "no note id", lines: ["U1"] },
        { action: "remove", note: "N2", lines: [] },
        { action: "remove", note: "N2", lines: ["U2"] },
        { action: "phrase", text: "x".repeat(121), lines: ["U1"] },
      ],
    });
    expect(parseAssistOutput(out)?.proposals).toEqual([
      { action: "add", kind: "person", name: "Ana", text: "Ana is my carer.", lines: ["U1"] },
      { action: "remove", note: "N2", lines: ["U2"] },
    ]);
  });

  it("is null without a say", () => {
    expect(parseAssistOutput('{"proposals": []}')).toBeNull();
    expect(parseAssistOutput("Sure, here is a note.")).toBeNull();
  });

  it("keeps at most 8 proposals", () => {
    const proposals = Array.from({ length: 10 }, (_, i) => ({ action: "phrase", text: `Phrase ${i}`, lines: ["U1"] }));
    expect(parseAssistOutput(JSON.stringify({ say: "ok", proposals }))?.proposals).toHaveLength(8);
  });
});

describe("clipSay", () => {
  it("cuts a long message at the last sentence end within 400 characters", () => {
    const text = `${"A short sentence. ".repeat(30)}`;
    const clipped = clipSay(text);
    expect(clipped.length).toBeLessThanOrEqual(400);
    expect(clipped.endsWith(".")).toBe(true);
  });
});

describe("buildAssistMessages", () => {
  it("shows notes, phrases, the chat with what was proposed, and the job's guidance", () => {
    const [, user] = buildAssistMessages({
      job: "prepare",
      today: "2026-10-05",
      lines: [
        { id: "U1", speaker: "user", text: "I'd like to prepare for an appointment." },
        { id: "A1", speaker: "assistant", text: "Who is it with?", proposed: ['phrase "Hello"'] },
        { id: "U2", speaker: "user", text: "Dr Chen" },
      ],
      notes: [{ id: "N1", kind: "about-me", text: "I'm Tom." }],
      phrases: [{ id: "Q1", text: "Please write it down.", for: "Dr. Chen" }],
    });
    expect(user.content).toContain("N1 (about-me): I'm Tom.");
    expect(user.content).toContain('Q1: "Please write it down." (for Dr. Chen)');
    expect(user.content).toContain("A1 You: Who is it with? (You proposed: phrase \"Hello\")");
    expect(user.content).toContain("U2 Me: Dr Chen");
    expect(user.content).toContain("Today is Monday 5 October 2026.");
    expect(user.content).toContain("who it is with, when, where");
  });

  it("gives every job's guidance when no job button was picked", () => {
    const [, user] = buildAssistMessages({ job: null, today: "2026-10-05", lines: [{ id: "U1", speaker: "user", text: "My doctor changed" }], notes: [], phrases: [] });
    expect(user.content).toContain("No job button was picked");
    for (const job of ["Job: update their information.", "Job: prepare for an appointment.", "Job: make quick phrases."]) expect(user.content).toContain(job);
  });
});
