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
});
