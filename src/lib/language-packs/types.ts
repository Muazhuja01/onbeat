export interface Reaction {
  id: string;
  text: string;
}

export interface VoiceOption {
  id: string;
  label: string;
  /** Written description for people who can't hear the sample. */
  description: string;
}

export interface LanguagePack {
  id: string;
  name: string;
  tier: "generative" | "retrieval-only";
  bcp47: string;
  maxWords: number;
  simpleMaxWords: number;
  reactions: Reaction[];
  voices: VoiceOption[];
  defaultVoice: string;
}
