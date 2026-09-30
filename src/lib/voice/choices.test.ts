import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE, describeVoice, isVoiceChoice, normalizeChoice, sampleText, speedValue, stylesFor, voiceId } from "./choices";

describe("voice choices", () => {
  it("maps each choice to its Kokoro voice", () => {
    expect(voiceId(DEFAULT_VOICE)).toBe("af_heart");
    expect(voiceId({ gender: "male", accent: "american", style: "calm", speed: "normal" })).toBe("am_michael");
    expect(voiceId({ gender: "male", accent: "british", style: "warm", speed: "normal" })).toBe("bm_fable");
    expect(voiceId({ gender: "female", accent: "british", style: "clear", speed: "normal" })).toBe("bf_isabella");
  });

  it("offers the agreed styles per voice and accent", () => {
    expect(stylesFor("female", "american").map((s) => s.label)).toEqual(["Warm", "Bright", "Soft"]);
    expect(stylesFor("female", "british").map((s) => s.label)).toEqual(["Warm", "Clear"]);
    expect(stylesFor("male", "american").map((s) => s.label)).toEqual(["Calm", "Deep", "Lively"]);
    expect(stylesFor("male", "british").map((s) => s.label)).toEqual(["Calm", "Warm"]);
  });

  it("falls back to the first style when a style doesn't exist for the pair", () => {
    expect(normalizeChoice({ gender: "female", accent: "british", style: "soft", speed: "faster" })).toEqual({ gender: "female", accent: "british", style: "warm", speed: "faster" });
  });

  it("gives speeds and a summary", () => {
    expect(speedValue({ ...DEFAULT_VOICE, speed: "slower" })).toBe(0.85);
    expect(speedValue(DEFAULT_VOICE)).toBe(1);
    expect(speedValue({ ...DEFAULT_VOICE, speed: "faster" })).toBe(1.15);
    expect(describeVoice({ gender: "male", accent: "american", style: "calm", speed: "normal" })).toBe("Male, American, calm");
  });

  it("checks stored or imported values", () => {
    expect(isVoiceChoice(DEFAULT_VOICE)).toBe(true);
    expect(isVoiceChoice({ ...DEFAULT_VOICE, style: "soft", accent: "british" })).toBe(false);
    expect(isVoiceChoice({ ...DEFAULT_VOICE, gender: "robot" })).toBe(false);
    expect(isVoiceChoice("af_heart")).toBe(false);
    expect(isVoiceChoice(null)).toBe(false);
  });

  it("writes the sample line", () => {
    expect(sampleText("Tom")).toBe("Hi, I'm Tom. This is how I'll sound.");
  });
});
