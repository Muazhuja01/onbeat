export type Gender = "female" | "male";
export type Accent = "american" | "british";
export type Speed = "slower" | "normal" | "faster";

export interface VoiceChoice {
  gender: Gender;
  accent: Accent;
  style: string;
  speed: Speed;
}

export const DEFAULT_VOICE: VoiceChoice = { gender: "female", accent: "american", style: "warm", speed: "normal" };

export const GENDERS: { value: Gender; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
];
export const ACCENTS: { value: Accent; label: string }[] = [
  { value: "american", label: "American" },
  { value: "british", label: "British" },
];
export const SPEEDS: { value: Speed; label: string; rate: number }[] = [
  { value: "slower", label: "Slower", rate: 0.85 },
  { value: "normal", label: "Normal", rate: 1 },
  { value: "faster", label: "Faster", rate: 1.15 },
];

/** Kokoro voices graded C or better in its own notes. Style words are checked by ear before release. */
const TABLE: Record<Gender, Record<Accent, { value: string; label: string; id: string }[]>> = {
  female: {
    american: [
      { value: "warm", label: "Warm", id: "af_heart" },
      { value: "bright", label: "Bright", id: "af_bella" },
      { value: "soft", label: "Soft", id: "af_nicole" },
    ],
    british: [
      { value: "warm", label: "Warm", id: "bf_emma" },
      { value: "clear", label: "Clear", id: "bf_isabella" },
    ],
  },
  male: {
    american: [
      { value: "calm", label: "Calm", id: "am_michael" },
      { value: "deep", label: "Deep", id: "am_fenrir" },
      { value: "lively", label: "Lively", id: "am_puck" },
    ],
    british: [
      { value: "calm", label: "Calm", id: "bm_george" },
      { value: "warm", label: "Warm", id: "bm_fable" },
    ],
  },
};

export const MALE_NOTE = "Male voices sound a little less natural than female ones for now.";

export function stylesFor(gender: Gender, accent: Accent): { value: string; label: string; id: string }[] {
  return TABLE[gender][accent];
}

export function normalizeChoice(c: VoiceChoice): VoiceChoice {
  const styles = stylesFor(c.gender, c.accent);
  return styles.some((s) => s.value === c.style) ? c : { ...c, style: styles[0].value };
}

export function voiceId(c: VoiceChoice): string {
  const n = normalizeChoice(c);
  return stylesFor(n.gender, n.accent).find((s) => s.value === n.style)!.id;
}

export function speedValue(c: VoiceChoice): number {
  return SPEEDS.find((s) => s.value === c.speed)?.rate ?? 1;
}

export function describeVoice(c: VoiceChoice): string {
  const n = normalizeChoice(c);
  const gender = GENDERS.find((g) => g.value === n.gender)!.label;
  const accent = ACCENTS.find((a) => a.value === n.accent)!.label;
  const style = stylesFor(n.gender, n.accent).find((s) => s.value === n.style)!.label.toLowerCase();
  return `${gender}, ${accent}, ${style}`;
}

export function isVoiceChoice(v: unknown): v is VoiceChoice {
  if (!v || typeof v !== "object") return false;
  const { gender, accent, style, speed } = v as Record<string, unknown>;
  if (gender !== "female" && gender !== "male") return false;
  if (accent !== "american" && accent !== "british") return false;
  if (!SPEEDS.some((s) => s.value === speed)) return false;
  return stylesFor(gender, accent).some((s) => s.value === style);
}

export function sampleText(name: string): string {
  return `Hi, I'm ${name}. This is how I'll sound.`;
}
