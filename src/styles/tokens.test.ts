import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contrastRatio, simulate, themes, type ColourBlindness, type ThemeName } from "./tokens";

type Key = keyof (typeof themes)["light"];

/** Text needs 4.5:1 (7:1 for body text); a surface edge needs 3:1. */
const PAIRS: [Key, Key, number][] = [
  ["ink", "ground", 7],
  ["ink", "surface", 7],
  ["ink", "raised", 7],
  ["muted", "ground", 4.5],
  ["muted", "surface", 4.5],
  ["muted", "raised", 4.5],
  ["partner", "ground", 4.5],
  ["partner", "surface", 4.5],
  ["onCue", "cue", 4.5],
  ["onBubble", "bubble", 7],
  ["bubble", "ground", 3],
  ["bubble", "surface", 3],
];
const VISIONS: (ColourBlindness | null)[] = [null, "protanopia", "deuteranopia", "tritanopia"];

describe("theme tokens", () => {
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("leaves black and white alone when simulating colour blindness", () => {
    for (const kind of ["protanopia", "deuteranopia", "tritanopia"] as const) {
      expect(simulate("#FFFFFF", kind)).toBe("#ffffff");
      expect(simulate("#000000", kind)).toBe("#000000");
    }
  });

  for (const [name, t] of Object.entries(themes)) {
    describe(name, () => {
      for (const [fg, bg, min] of PAIRS) {
        for (const vision of VISIONS) {
          it(`${fg} on ${bg} meets ${min}:1${vision ? ` with ${vision}` : ""}`, () => {
            const a = vision ? simulate(t[fg], vision) : t[fg];
            const b = vision ? simulate(t[bg], vision) : t[bg];
            expect(contrastRatio(a, b)).toBeGreaterThanOrEqual(min);
          });
        }
      }
      it("the cue light is visible (fill or its ink border meets 3:1)", () => {
        const fill = contrastRatio(t.cue, t.ground);
        const border = contrastRatio(t.ink, t.ground);
        expect(Math.max(fill, border)).toBeGreaterThanOrEqual(3);
      });
    });
  }
});

describe("globals.css", () => {
  const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
  /** The colour variables in the rule after `anchor`, e.g. { "on-cue": "#15233b" }. */
  function colours(anchor: string): Record<string, string> {
    const at = css.indexOf(anchor);
    expect(at, `globals.css has ${anchor}`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf("{", at);
    // A media query's own brace comes first: the variables are in the rule inside it.
    const start = anchor.startsWith("@media") ? css.indexOf("{", open + 1) : open;
    const body = css.slice(start + 1, css.indexOf("}", start));
    return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map(([, name, hex]) => [name, hex.toLowerCase()]));
  }
  const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const RULES: [string, ThemeName][] = [
    [':root,\n[data-theme="light"]', "light"],
    ["@media (prefers-color-scheme: dark)", "dark"],
    ['[data-theme="dark"] {', "dark"],
    ['[data-theme="contrast"] {', "contrast"],
    ["@media (prefers-contrast: more)", "contrast"],
  ];

  it.each(RULES)("uses the %s colours from tokens.ts", (anchor, theme) => {
    const expected = Object.fromEntries(Object.entries(themes[theme]).map(([key, hex]) => [kebab(key), hex.toLowerCase()]));
    // Every token, and no solid colour that tokens.ts doesn't check.
    const actual = colours(anchor);
    delete actual.edge; // Not a token: a faint ink line, or white in high contrast.
    expect(actual).toEqual(expected);
  });
});
