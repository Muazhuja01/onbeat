import { describe, expect, it } from "vitest";
import { joinPieces, trimRepeatedTail } from "./transcript";

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

describe("joinPieces", () => {
  const piece = (text: string, forced = false) => ({ text, forced });

  it("joins pieces cut at pauses as they are", () => {
    expect(joinPieces([piece("So we never argued."), piece("You know, he held things in.")])).toBe("So we never argued. You know, he held things in.");
  });

  it("smooths a cut made mid-flow: no full stop, no capital", () => {
    // Real Moonshine pieces either side of a cut with no pause.
    expect(joinPieces([piece("So we were the type of.", true), piece("Couple who never argued.")])).toBe("So we were the type of couple who never argued.");
  });

  it("keeps the capital on I", () => {
    expect(joinPieces([piece("Because he's the runner, but when.", true), piece("I'm tired I say it.")])).toBe(
      "Because he's the runner, but when I'm tired I say it.",
    );
  });

  it("keeps one copy of a word split across a cut", () => {
    expect(joinPieces([piece("but when i", true), piece("I say it.")])).toBe("but when I say it.");
  });

  it("keeps questions and skips empty pieces", () => {
    expect(joinPieces([piece("Is it free?", true), piece(""), piece("Thanks.")])).toBe("Is it free? Thanks.");
  });
});
