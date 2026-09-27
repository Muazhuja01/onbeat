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
  },
  dark: {
    ground: "#101826",
    surface: "#172234",
    ink: "#E8EDF4",
    muted: "#A9B6C8",
    cue: "#F5B656",
    onCue: "#101826",
    partner: "#8DB8E3",
  },
  contrast: {
    ground: "#000000",
    surface: "#000000",
    ink: "#FFFFFF",
    muted: "#FFFFFF",
    cue: "#FFD166",
    onCue: "#000000",
    partner: "#FFFFFF",
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
