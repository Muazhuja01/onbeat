/** Source of truth for theme colours. globals.css must use the same values. */
export const themes = {
  light: {
    ground: "#EEF1F4",
    surface: "#FAFBFC",
    ink: "#15233B",
    muted: "#4A5A70",
    cue: "#F2A93B",
    onCue: "#15233B",
    partner: "#2D5B86",
    raised: "#FFFFFF",
    bubble: "#15233B",
    onBubble: "#F3F6FA",
  },
  dark: {
    ground: "#101826",
    surface: "#172234",
    ink: "#E8EDF4",
    muted: "#A9B6C8",
    cue: "#F5B656",
    onCue: "#101826",
    partner: "#8DB8E3",
    raised: "#1E2B41",
    bubble: "#E8EDF4",
    onBubble: "#101826",
  },
  contrast: {
    ground: "#000000",
    surface: "#000000",
    ink: "#FFFFFF",
    muted: "#FFFFFF",
    cue: "#FFD166",
    onCue: "#000000",
    partner: "#FFFFFF",
    raised: "#000000",
    bubble: "#FFFFFF",
    onBubble: "#000000",
  },
} as const;

export type ThemeName = keyof typeof themes;

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(n.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export type ColourBlindness = "protanopia" | "deuteranopia" | "tritanopia";

/** Machado, Oliveira and Fernandes (2009) at full severity, applied to linear RGB. */
const CVD: Record<ColourBlindness, number[][]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const toSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** How `hex` looks to someone with the given colour blindness, as a lower-case hex colour. */
export function simulate(hex: string, kind: ColourBlindness): string {
  const n = hex.replace("#", "");
  const lin = [0, 2, 4].map((i) => channel(parseInt(n.slice(i, i + 2), 16)));
  const out = CVD[kind].map((row) => clamp(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]));
  return `#${out.map((v) => Math.round(clamp(toSrgb(v)) * 255).toString(16).padStart(2, "0")).join("")}`;
}
