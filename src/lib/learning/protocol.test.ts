import { describe, expect, it } from "vitest";
import { LearnRequestSchema, ProposalSchema } from "./protocol";

const line = (i: number) => ({ id: `l${i}`, speaker: "partner" as const, text: "Your physio moved to Thursdays." });

describe("LearnRequestSchema", () => {
  it("accepts a batch", () => {
    const body = { today: "2026-09-30", lines: [line(1), { ...line(2), speaker: "user", partnerName: "Leila", placeName: "Home" }], notes: [{ id: "n1", kind: "routine", text: "Physio on Tuesdays." }] };
    expect(LearnRequestSchema.safeParse(body).success).toBe(true);
  });

  it("refuses a batch that is empty, too big, or has a bad date or line", () => {
    const ok = { today: "2026-09-30", lines: [line(1)], notes: [] };
    expect(LearnRequestSchema.safeParse({ ...ok, lines: [] }).success).toBe(false);
    expect(LearnRequestSchema.safeParse({ ...ok, lines: Array.from({ length: 41 }, (_, i) => line(i)) }).success).toBe(false);
    expect(LearnRequestSchema.safeParse({ ...ok, today: "30/09/2026" }).success).toBe(false);
    expect(LearnRequestSchema.safeParse({ ...ok, lines: [{ ...line(1), text: "   " }] }).success).toBe(false);
    expect(LearnRequestSchema.safeParse({ ...ok, lines: [{ ...line(1), text: "x".repeat(501) }] }).success).toBe(false);
    const notes = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, kind: "routine", text: "x" }));
    expect(LearnRequestSchema.safeParse({ ...ok, notes }).success).toBe(false);
  });
});

describe("ProposalSchema", () => {
  it("needs a kind, text and at least one line", () => {
    expect(ProposalSchema.safeParse({ action: "add", kind: "person", name: "Ana", text: "Ana is my carer.", lineIds: ["l1"] }).success).toBe(true);
    expect(ProposalSchema.safeParse({ action: "add", kind: "friend", text: "x", lineIds: ["l1"] }).success).toBe(false);
    expect(ProposalSchema.safeParse({ action: "add", kind: "routine", text: "x", lineIds: [] }).success).toBe(false);
    expect(ProposalSchema.safeParse({ action: "add", kind: "routine", text: "x".repeat(301), lineIds: ["l1"] }).success).toBe(false);
  });
});
