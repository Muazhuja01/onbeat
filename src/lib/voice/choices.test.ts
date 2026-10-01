import { describe, expect, it } from "vitest";
import { ACCENTS, DEFAULT_VOICE, VOICE_IDS, backupVoice, describeVoice, isVoiceChoice, migrateChoice, normalizeChoice, sampleText, speedValue, stylesFor, voiceId, type VoiceChoice } from "./choices";

const c = (gender: "female" | "male", accent: "american" | "canadian" | "british", style: string, speed: VoiceChoice["speed"] = "normal"): VoiceChoice => ({ gender, accent, style, speed, v: 2 });

describe("voice choices", () => {
  it("offers the owner's 13 voices", () => {
    expect(ACCENTS.map((a) => a.label)).toEqual(["American", "Canadian", "British"]);
    expect(stylesFor("female", "american").map((s) => s.label)).toEqual(["Bright", "Clear", "Calm", "Warm"]);
    expect(stylesFor("female", "canadian").map((s) => s.label)).toEqual(["Lively"]);
    expect(stylesFor("female", "british").map((s) => s.label)).toEqual(["Calm", "Bright"]);
    expect(stylesFor("male", "american").map((s) => s.label)).toEqual(["Deep"]);
    expect(stylesFor("male", "canadian").map((s) => s.label)).toEqual(["Warm"]);
    expect(stylesFor("male", "british").map((s) => s.label)).toEqual(["Calm", "Warm", "Bright", "Gentle"]);
    expect(VOICE_IDS).toEqual(["f_us_bright", "f_us_clear", "f_us_calm", "f_us_warm", "f_ca_lively", "f_gb_calm", "f_gb_bright", "m_us_deep", "m_ca_warm", "m_gb_calm", "m_gb_warm", "m_gb_bright", "m_gb_gentle"]);
  });

  it("maps each choice to its Chatterbox voice and Kokoro partner", () => {
    expect(voiceId(DEFAULT_VOICE)).toBe("f_us_bright");
    expect(voiceId(c("male", "british", "gentle"))).toBe("m_gb_gentle");
    const partners = Object.fromEntries(VOICE_IDS.map((id) => [id, backupVoice(id)]));
    expect(partners).toEqual({
      f_us_bright: "af_heart", f_us_clear: "af_bella", f_us_calm: "af_nicole", f_us_warm: "af_heart",
      f_ca_lively: "af_bella", f_gb_calm: "bf_emma", f_gb_bright: "bf_isabella",
      m_us_deep: "am_fenrir", m_ca_warm: "am_michael",
      m_gb_calm: "bm_george", m_gb_warm: "bm_fable", m_gb_bright: "bm_fable", m_gb_gentle: "bm_george",
    });
    expect(backupVoice("nope")).toBe("af_heart");
  });

  it("defaults to the built-in voice", () => {
    expect(DEFAULT_VOICE).toEqual(c("female", "american", "bright"));
  });

  it("falls back to the first style when a style doesn't exist for the pair", () => {
    expect(normalizeChoice(c("male", "canadian", "gentle", "faster"))).toEqual(c("male", "canadian", "warm", "faster"));
  });

  it("moves old Kokoro choices to the nearest new voice", () => {
    const old = (gender: string, accent: string, style: string, speed = "normal") => ({ gender, accent, style, speed });
    expect(migrateChoice(old("female", "american", "warm"))).toEqual(c("female", "american", "bright"));
    expect(migrateChoice(old("female", "american", "bright", "slower"))).toEqual(c("female", "american", "clear", "slower"));
    expect(migrateChoice(old("female", "american", "soft"))).toEqual(c("female", "american", "calm"));
    expect(migrateChoice(old("female", "british", "warm"))).toEqual(c("female", "british", "calm"));
    expect(migrateChoice(old("female", "british", "clear"))).toEqual(c("female", "british", "bright"));
    for (const style of ["calm", "deep", "lively"]) expect(migrateChoice(old("male", "american", style))).toEqual(c("male", "american", "deep"));
    expect(migrateChoice(old("male", "british", "calm", "faster"))).toEqual(c("male", "british", "calm", "faster"));
    expect(migrateChoice(old("male", "british", "warm"))).toEqual(c("male", "british", "warm"));
  });

  it("keeps new choices as they are, field by field", () => {
    expect(migrateChoice({ ...c("female", "american", "warm"), extra: "x" })).toEqual(c("female", "american", "warm"));
  });

  it("refuses values that are neither", () => {
    expect(migrateChoice({ gender: "male", accent: "british", style: "deep", speed: "normal" })).toBeNull();
    expect(migrateChoice({ gender: "female", accent: "american", style: "warm", speed: "fast" })).toBeNull();
    expect(migrateChoice("af_heart")).toBeNull();
    expect(migrateChoice(null)).toBeNull();
  });

  it("gives speeds and a summary", () => {
    expect(speedValue({ ...DEFAULT_VOICE, speed: "slower" })).toBe(0.85);
    expect(speedValue(DEFAULT_VOICE)).toBe(1);
    expect(speedValue({ ...DEFAULT_VOICE, speed: "faster" })).toBe(1.15);
    expect(describeVoice(c("male", "canadian", "warm"))).toBe("Male, Canadian, warm");
  });

  it("checks stored or imported values", () => {
    expect(isVoiceChoice(DEFAULT_VOICE)).toBe(true);
    expect(isVoiceChoice({ gender: "female", accent: "american", style: "bright", speed: "normal" })).toBe(false);
    expect(isVoiceChoice({ ...DEFAULT_VOICE, style: "lively" })).toBe(false);
    expect(isVoiceChoice(null)).toBe(false);
  });

  it("writes the sample line", () => {
    expect(sampleText("Tom")).toBe("Hi, I'm Tom. This is how I'll sound.");
  });
});
