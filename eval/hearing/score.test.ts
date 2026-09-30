import { describe, expect, it } from "vitest";
import { normalizeWords, scoreClip, summarize, wordErrors } from "./score";

describe("normalizeWords", () => {
  it("lowercases, drops punctuation and filler, splits hyphens", () => {
    expect(normalizeWords("YEAH I MEAN, UM, THAT'S A WELL-KNOWN one?")).toEqual(["yeah", "i", "mean", "that's", "a", "well", "known", "1"]);
    expect(normalizeWords("Mm-hmm. Uh, okay.")).toEqual(["okay"]);
  });

  it("treats curly and straight apostrophes alike", () => {
    expect(normalizeWords("What’s your name")).toEqual(["what's", "your", "name"]);
  });

  // The same forgiveness as Whisper's English normalizer, so numbers compare with published ones.
  it("expands contractions", () => {
    expect(normalizeWords("If you've got it, you won't mind. I'm sure they'll say we'd can't")).toEqual(
      normalizeWords("If you have got it, you will not mind. I am sure they will say we would can not"),
    );
  });

  it("writes spelled-out numbers as digits", () => {
    expect(normalizeWords("ninety nine")).toEqual(["99"]);
    expect(normalizeWords("the nineties")).toEqual(["the", "90s"]);
    expect(normalizeWords("two hundred and five people")).toEqual(["205", "people"]);
    expect(normalizeWords("a table for two")).toEqual(["a", "table", "for", "2"]);
  });

  it("uses American spellings and one spelling of okay", () => {
    expect(normalizeWords("The colours of the programme, OK")).toEqual(["the", "colors", "of", "the", "program", "okay"]);
  });
});

describe("wordErrors", () => {
  it("counts substitutions, deletions and insertions", () => {
    expect(wordErrors(["give", "me", "your", "name"], ["give"])).toBe(3);
    expect(wordErrors(["a", "b", "c"], ["a", "x", "c", "d"])).toBe(2);
    expect(wordErrors([], [])).toBe(0);
  });
});

describe("scoreClip", () => {
  it("flags a caption that lost most of the sentence as cut off", () => {
    const s = scoreClip("Give me your name.", ["Give"]);
    expect(s).toMatchObject({ refWords: 4, errors: 3, cutOff: true, split: false, missed: false });
  });

  it("flags a sentence shown as several lines, and joins them to score the words", () => {
    const s = scoreClip("Okay, can I have your name written on it?", ["Okay,", "can I have your name written on it?"]);
    expect(s).toMatchObject({ errors: 0, split: true, cutOff: false });
  });

  it("flags a clip that produced no caption", () => {
    expect(scoreClip("Hello there", [])).toMatchObject({ missed: true, cutOff: true, errors: 2 });
  });
});

describe("summarize", () => {
  it("pools word errors over all words, and rates over clips", () => {
    const clips = [scoreClip("give me your name", ["give"]), scoreClip("what's your name", ["what's your name"])];
    expect(summarize(clips)).toEqual({ clips: 2, wer: 3 / 7, exact: 0.5, cutOff: 0.5, split: 0, missed: 0 });
  });
});
