import { describe, expect, it } from "vitest";
import { AssistProposalSchema, AssistRequestSchema } from "./protocol";

const base = {
  job: "prepare",
  today: "2026-10-05",
  lines: [{ id: "u1", speaker: "user", text: "I see Dr Chen on Thursday." }],
  notes: [{ id: "n1", kind: "about-me", text: "I'm Tom." }],
  phrases: [{ id: "p1", text: "Please write it down.", for: "Dr. Chen" }],
};

describe("AssistRequestSchema", () => {
  it("accepts a chat that ends with the user's line", () => {
    expect(AssistRequestSchema.safeParse(base).success).toBe(true);
    expect(AssistRequestSchema.safeParse({ ...base, job: null }).success).toBe(true);
  });

  it("refuses a chat that ends with the assistant's line", () => {
    const lines = [...base.lines, { id: "a1", speaker: "assistant", text: "When?", proposed: [] }];
    expect(AssistRequestSchema.safeParse({ ...base, lines }).success).toBe(false);
  });

  it("refuses more than 20 user lines", () => {
    const lines = Array.from({ length: 21 }, (_, i) => ({ id: `u${i}`, speaker: "user", text: "hi" }));
    expect(AssistRequestSchema.safeParse({ ...base, lines }).success).toBe(false);
  });

  it("refuses notes over the character budget", () => {
    const notes = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, kind: "routine", text: "x".repeat(300) }));
    expect(AssistRequestSchema.safeParse({ ...base, notes }).success).toBe(false);
  });
});

describe("AssistProposalSchema", () => {
  it("reads each kind", () => {
    for (const p of [
      { action: "add", kind: "person", name: "Ana", text: "Ana is my carer.", lineIds: ["u1"] },
      { action: "edit", kind: "routine", noteId: "n2", text: "Physio on Thursdays.", lineIds: ["u1"] },
      { action: "remove", noteId: "n2", lineIds: ["u1"] },
      { action: "phrase", text: "Can we go over my dose?", for: "Dr. Chen", lineIds: ["u1"] },
    ]) {
      expect(AssistProposalSchema.safeParse(p).success).toBe(true);
    }
  });

  it("refuses a phrase over 120 characters", () => {
    expect(AssistProposalSchema.safeParse({ action: "phrase", text: "x".repeat(121), lineIds: ["u1"] }).success).toBe(false);
  });
});
