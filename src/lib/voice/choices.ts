export type Gender = "female" | "male";
export type Accent = "american" | "canadian" | "british";
export type Speed = "slower" | "normal" | "faster";

/** v: 2 marks a Chatterbox choice; a stored value without it is an older Kokoro choice (see migrateChoice). */
export interface VoiceChoice {
  gender: Gender;
  accent: Accent;
  style: string;
  speed: Speed;
  v: 2;
}

export const DEFAULT_VOICE: VoiceChoice = { gender: "female", accent: "american", style: "bright", speed: "normal", v: 2 };

export const GENDERS: { value: Gender; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
];
export const ACCENTS: { value: Accent; label: string }[] = [
  { value: "american", label: "American" },
  { value: "canadian", label: "Canadian" },
  { value: "british", label: "British" },
];
export const SPEEDS: { value: Speed; label: string; rate: number }[] = [
  { value: "slower", label: "Slower", rate: 0.85 },
  { value: "normal", label: "Normal", rate: 1 },
  { value: "faster", label: "Faster", rate: 1.15 },
];

export interface Style {
  value: string;
  label: string;
  /** The voice server's id (voice-server/voices.py). */
  id: string;
  /** The Kokoro voice that speaks when Chatterbox can't. */
  backup: string;
}

/** Picked by ear by the owner (2026-10-01); style words from measured pitch, pace and tone. */
const TABLE: Record<Gender, Record<Accent, Style[]>> = {
  female: {
    american: [
      { value: "bright", label: "Bright", id: "f_us_bright", backup: "af_heart" },
      { value: "clear", label: "Clear", id: "f_us_clear", backup: "af_bella" },
      { value: "calm", label: "Calm", id: "f_us_calm", backup: "af_nicole" },
      { value: "warm", label: "Warm", id: "f_us_warm", backup: "af_heart" },
    ],
    canadian: [{ value: "lively", label: "Lively", id: "f_ca_lively", backup: "af_bella" }],
    british: [
      { value: "calm", label: "Calm", id: "f_gb_calm", backup: "bf_emma" },
      { value: "bright", label: "Bright", id: "f_gb_bright", backup: "bf_isabella" },
    ],
  },
  male: {
    american: [{ value: "deep", label: "Deep", id: "m_us_deep", backup: "am_fenrir" }],
    canadian: [{ value: "warm", label: "Warm", id: "m_ca_warm", backup: "am_michael" }],
    british: [
      { value: "calm", label: "Calm", id: "m_gb_calm", backup: "bm_george" },
      { value: "warm", label: "Warm", id: "m_gb_warm", backup: "bm_fable" },
      { value: "bright", label: "Bright", id: "m_gb_bright", backup: "bm_fable" },
      { value: "gentle", label: "Gentle", id: "m_gb_gentle", backup: "bm_george" },
    ],
  },
};

const ALL: Style[] = GENDERS.flatMap((g) => ACCENTS.flatMap((a) => TABLE[g.value][a.value]));
export const VOICE_IDS: readonly string[] = ALL.map((s) => s.id);

/** Kokoro choices from before Chatterbox, keyed gender|accent|style, to the nearest new style. */
const OLD_STYLES: Record<string, string> = {
  "female|american|warm": "bright",
  "female|american|bright": "clear",
  "female|american|soft": "calm",
  "female|british|warm": "calm",
  "female|british|clear": "bright",
  "male|american|calm": "deep",
  "male|american|deep": "deep",
  "male|american|lively": "deep",
  "male|british|calm": "calm",
  "male|british|warm": "warm",
};

export function stylesFor(gender: Gender, accent: Accent): Style[] {
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

export function backupVoice(id: string): string {
  return ALL.find((s) => s.id === id)?.backup ?? "af_heart";
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
  const { gender, accent, style, speed, v: version } = v as Record<string, unknown>;
  if (version !== 2) return false;
  if (gender !== "female" && gender !== "male") return false;
  if (!ACCENTS.some((a) => a.value === accent)) return false;
  if (!SPEEDS.some((s) => s.value === speed)) return false;
  return stylesFor(gender, accent as Accent).some((s) => s.value === style);
}

/** A stored or imported voice as a current choice, rebuilt field by field: new choices as they are, old Kokoro ones moved to the nearest voice, anything else null. */
export function migrateChoice(v: unknown): VoiceChoice | null {
  if (isVoiceChoice(v)) return { gender: v.gender, accent: v.accent, style: v.style, speed: v.speed, v: 2 };
  if (!v || typeof v !== "object") return null;
  const { gender, accent, style, speed } = v as Record<string, unknown>;
  const moved = OLD_STYLES[`${String(gender)}|${String(accent)}|${String(style)}`];
  const pace = SPEEDS.find((s) => s.value === speed);
  if (!moved || !pace) return null;
  return { gender: gender as Gender, accent: accent as Accent, style: moved, speed: pace.value, v: 2 };
}

export function sampleText(name: string): string {
  return `Hi, I'm ${name}. This is how I'll sound.`;
}
