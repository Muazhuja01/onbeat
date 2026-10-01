import { describe, expect, it } from "vitest";
import { Speculation } from "./speculation";

describe("Speculation", () => {
  it("waits for 3 words before the first request", () => {
    const s = new Speculation();
    expect(s.shouldSend("What size", 10_000)).toBe(false);
    expect(s.shouldSend("What size would", 10_000)).toBe(true);
  });

  it("sends at most every 2.5 s and only after 3 new words", () => {
    const s = new Speculation();
    s.sent("What size would", 10_000);
    expect(s.shouldSend("What size would you like today", 11_000)).toBe(false);
    expect(s.shouldSend("What size would you", 13_000)).toBe(false);
    expect(s.shouldSend("What size would you like today", 12_500)).toBe(true);
  });

  it("counts words again on a new turn but keeps the spacing", () => {
    const s = new Speculation();
    s.sent("one two three four five six", 10_000);
    s.newTurn();
    expect(s.shouldSend("Hi there Maya", 11_000)).toBe(false);
    expect(s.shouldSend("Hi there Maya", 12_500)).toBe(true);
  });

  it("skips the final request when the same words are on their way or answered", () => {
    const s = new Speculation();
    s.sent("what size would you like", 10_000);
    expect(s.needsFinal("What size would you like?")).toBe(false);
    s.finished("what size would you like", true);
    expect(s.needsFinal("What size would you like?")).toBe(false);
    expect(s.needsFinal("What size would you like today?")).toBe(true);
  });

  it("asks again when the speculative request failed or the turn is over", () => {
    const s = new Speculation();
    s.sent("what size would you like", 10_000);
    s.finished("what size would you like", false);
    expect(s.needsFinal("What size would you like?")).toBe(true);
    s.sent("what size would", 20_000);
    s.finished("what size would", true);
    s.turnDone();
    expect(s.needsFinal("what size would")).toBe(true);
  });

  it("on a line carried on after a pause, counts only the new words", () => {
    const s = new Speculation();
    s.newTurn("So the physio");
    expect(s.shouldSend("So the physio moved", 10_000)).toBe(false);
    expect(s.shouldSend("So the physio moved to Thursdays", 10_000)).toBe(true);
  });
});
