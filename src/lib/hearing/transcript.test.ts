import { describe, expect, it } from "vitest";
import { trimRepeatedTail } from "./transcript";

describe("trimRepeatedTail", () => {
  it("keeps one copy when the decoder loops until its token limit", () => {
    // Real Moonshine output on a noisy 1.7 s clip.
    expect(trimRepeatedTail("can I have your name written on it can I have your name written on it can I have your")).toBe(
      "can I have your name written on it",
    );
    expect(trimRepeatedTail("Okay can i have your name written on it okay can i have your name written on it okay can i have your")).toBe(
      "Okay can i have your name written on it",
    );
  });

  it("catches a short phrase looping many times", () => {
    expect(trimRepeatedTail("Thank you. Thank you. Thank you. Thank you. Thank you.")).toBe("Thank you.");
  });

  it("leaves normal speech alone", () => {
    for (const text of [
      "Can I have your name written on it?",
      "What's your name?",
      "No, no, I said the large one.",
      "Is that for here or to go, or to go with a lid?",
      "",
    ]) {
      expect(trimRepeatedTail(text)).toBe(text);
    }
  });

  it("only trims a loop at the end, where a runaway decode stops", () => {
    const text = "Thank you, thank you, that's very kind, see you tomorrow.";
    expect(trimRepeatedTail(text)).toBe(text);
  });
});
