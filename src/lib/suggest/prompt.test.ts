import { describe, expect, it } from "vitest";
import { buildMessages } from "./prompt";
import type { SuggestRequestBody } from "./protocol";

const body: SuggestRequestBody = {
  mode: "replies+reactions",
  typed: "large",
  partnerSaid: "What size would you like?",
  contextLine: "It is Tuesday morning. Place: Blue Door Café. Talking with: Sam.",
  notes: [{ id: "usual", text: "My usual is a large oat milk latte." }],
  examples: ["My usual, please."],
  reactions: [{ id: "ha", text: "Ha!" }],
  maxWords: 15,
};

describe("buildMessages", () => {
  it("puts everything the model needs in the user message", () => {
    const [system, user] = buildMessages(body);
    expect(system.role).toBe("system");
    expect(user.role).toBe("user");
    for (const s of ["What size would you like?", '"large"', "[usual] My usual is a large oat milk latte.", "- My usual, please.", "at most 15 words", "ha: Ha!", '{"reactions"']) {
      expect(user.content).toContain(s);
    }
  });

  it("leaves reactions out in replies mode", () => {
    const [, user] = buildMessages({ ...body, mode: "replies" });
    expect(user.content).not.toContain("reactions");
  });

  it("says when there are no notes or examples", () => {
    const [, user] = buildMessages({ ...body, notes: [], examples: [], typed: "", partnerSaid: "" });
    expect(user.content).toContain("(none)");
    expect(user.content).toContain("(nothing yet)");
  });

  it("asks for a direct answer, a detail from the notes, and an opposite or neutral answer", () => {
    const [, user] = buildMessages(body);
    expect(user.content).toContain("Reply 1 answers directly.");
    expect(user.content).toContain("Reply 2 answers with one detail from the notes or the conversation.");
    expect(user.content).toContain("Reply 3 gives the opposite or a neutral answer");
    expect(user.content).not.toMatch(/alternative/i);
  });

  it("forbids anything about the person the sources don't say, with examples", () => {
    const [, user] = buildMessages(body);
    expect(user.content).toContain("what they did, have, feel, want, plan or prefer");
    expect(user.content).toContain('"Not sure yet."');
    expect(user.content).toContain('"Maybe a mocha today?"');
  });

  it("keeps all three replies on the typed meaning when the person has typed", () => {
    const [, user] = buildMessages(body);
    expect(user.content).toContain("If the person has typed something, all 3 replies keep that meaning");
  });
});
