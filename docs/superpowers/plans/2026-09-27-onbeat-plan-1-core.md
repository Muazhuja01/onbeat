# OnBeat Plan 1: Core conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working web app where a user picks an example profile, enters what the other person said, gets three checked, personal reply suggestions, and speaks one with a natural in-browser voice.

**Architecture:** Next.js 16 app. Notes and past phrases live in the browser (Orama index, IndexedDB persistence, MiniLM embeddings in a web worker). A single server route forwards prompts to Groq with Cerebras as fallback and streams newline-delimited JSON back. The client validates every reply (no invented names, numbers, days or times) before showing it. Kokoro TTS runs in a second worker; the browser's speech engine is the fallback.

**Tech Stack:** Next.js 16.3 (Turbopack), React 19, TypeScript, Tailwind CSS 4, @orama/orama 3.1, @huggingface/transformers 3.8.1 (pinned: kokoro-js depends on v3), kokoro-js 1.2, Zod 4, idb-keyval 6, @phosphor-icons/react 2, Vitest 5 + Testing Library, Playwright + @axe-core/playwright.

**Spec:** `docs/superpowers/specs/2026-09-27-onbeat-design.md` (read it first). Research notes: `docs/research-notes.md`.

**Scope of this plan:** spec build-order steps 1 to 4 (setup, memory, suggestion engine, conversation screen with typing and voice). Microphone, speculative requests, eval (plan 2) and notes/settings/first-run screens, deploy, demo (plan 3) come later. In this plan the other person's words are typed into a "What they said" box, which the spec also keeps as the no-microphone fallback.

## Global Constraints

- Node 24, npm 11. Run `npm i` without `--silent` (npm 11 fails quietly with it). npm 11 blocks install scripts; that is fine for this plan (no native modules are needed in the browser or in Vitest).
- `@huggingface/transformers` is pinned to exactly `3.8.1`. Do not install v4.
- Next.js 16 has breaking changes from older versions. Before writing Next-specific code, read the relevant guide in `node_modules/next/dist/docs/` (see `AGENTS.md`).
- UI copy: plain, active voice, second person, sentence case (not Title Case). No em dash or en dash characters anywhere in UI strings or docs. Use `…` (single character) for loading states and placeholders.
- Colour is never the only signal: every state also has text and/or an icon.
- Colours only through tokens (`bg-ground`, `bg-surface`, `text-ink`, `text-muted`, `bg-cue`, `text-partner`, border variants). No raw hex in components.
- Reply buttons at least 64 px tall and full width; every other control at least 48 x 48 px.
- Never `transition: all`; never remove focus outlines without the global replacement; honour `prefers-reduced-motion`.
- Icons from `@phosphor-icons/react` only; every icon either `aria-hidden` next to text or inside a control with an `aria-label`.
- Personal notes never leave the browser except the (at most 8) notes sent with a suggestion request.
- API keys only in server environment variables `GROQ_API_KEY`, `CEREBRAS_API_KEY`. Never in client code, never committed.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The repo owner edits files on GitHub directly: run `git pull --rebase` before every `git push`.
- `npm run lint`, `npm run typecheck` and `npm test` must pass at the end of every task. If `eslint-config-next` 16's React hooks rules flag a pattern in this plan (for example ref writes during render), fix it the way the rule suggests without changing behaviour.

## Review Focus

1. **Model output is messy** (fewer than 3 lines, markdown fences, prose, a truncated last line): the app shows only the valid replies and never crashes. Pinned by the "ignores junk lines" and "keeps partial results on mid-stream failure" tests in Task 9.
2. **Stale responses arrive late** (the user keeps typing and an older request finishes after a newer one): an older result never replaces a newer one. Pinned by "a newer request cancels the older one" in Task 9.
3. **Names with accents or apostrophes** ("Zoë", "O'Brien", "Café" vs "Cafe"): the invented-detail check treats them as the same name. Pinned in Task 4.
4. **Very long input** (a pasted paragraph in either text box): the client clamps before sending, so the server never rejects a normal request. Pinned by "clamps long input" in Task 9.
5. **Double or overlapping speech** (tapping a second reply while the first is still playing): the first stops, audio never overlaps, and the "end" event fires once per utterance. Pinned by "speaking again stops the previous utterance" in Task 10.

---

### Task 1: Project setup and tooling

**Files:**
- Create (from generator): `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `AGENTS.md`, `CLAUDE.md`, `public/*`, `src/app/*`
- Create: `vitest.config.ts`, `vitest.setup.ts`, `src/lib/smoke.test.ts`, `.env.example`, `.github/workflows/ci.yml`
- Modify: `.gitignore`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:watch`, `e2e`; path alias `@/*` -> `src/*`.

- [ ] **Step 1: Create a feature branch**

```bash
cd C:/Users/hujai/onbeat
git pull --rebase
git checkout -b feat/core
```

- [ ] **Step 2: Generate the Next.js app outside the repo and copy it in**

The repo already has a README, LICENSE and .gitignore, so generate into a sibling folder and copy selected files.

```bash
cd C:/Users/hujai
npx -y create-next-app@16.3 onbeat-scaffold --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
cd onbeat-scaffold
cp -r package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs AGENTS.md CLAUDE.md public src ../onbeat/
cd ../onbeat
rm -rf ../onbeat-scaffold
```

Then set `"name": "onbeat"` in `package.json`.

- [ ] **Step 3: Install dependencies**

```bash
npm i @huggingface/transformers@3.8.1 kokoro-js@1.2.1 @orama/orama@3.1.18 zod@4 idb-keyval@6 @phosphor-icons/react@2
npm i -D vitest@5 @vitejs/plugin-react jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom fake-indexeddb @playwright/test @axe-core/playwright
```

- [ ] **Step 4: Add scripts to `package.json`**

Replace the `"scripts"` block with:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "e2e": "playwright test"
}
```

- [ ] **Step 5: Configure Vitest**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

`vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

If Vitest 5 rejects any key, read `node_modules/vitest/dist/*.d.ts` for the current name and adjust; keep jsdom as the default environment.

- [ ] **Step 6: Write a smoke test**

`src/lib/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("test setup", () => {
  it("runs in a DOM environment", () => {
    const el = document.createElement("p");
    el.textContent = "ready";
    expect(el).toHaveTextContent("ready");
  });
});
```

- [ ] **Step 7: Environment example and gitignore**

`.env.example`:

```
# Free keys: https://console.groq.com/keys and https://cloud.cerebras.ai
GROQ_API_KEY=
CEREBRAS_API_KEY=
```

Append to `.gitignore`:

```
# local tool output
.playwright-mcp/
```

- [ ] **Step 8: CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 9: Verify**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all pass; Vitest reports 1 passed test.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Set up Next.js 16 app with Vitest and CI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Design tokens, font and app shell

**Files:**
- Create: `src/styles/tokens.ts`, `src/styles/tokens.test.ts`
- Replace: `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`
- Delete: default demo assets in `public/` that the generated page used (`next.svg`, `vercel.svg`, `file.svg`, `globe.svg`, `window.svg`)

**Interfaces:**
- Produces: Tailwind colour utilities `ground`, `surface`, `ink`, `muted`, `cue`, `partner`; text sizes `text-caption`, `text-reply`, `text-body`, `text-label`; radius `rounded-control`; CSS class `conv-grid` with grid areas `context`, `log`, `side`; `.sr-only` (Tailwind built-in); skip link target id `replies`; localStorage key `onbeat:theme` (`system` | `light` | `dark` | `contrast`).

- [ ] **Step 1: Write the failing contrast test**

`src/styles/tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { contrastRatio, themes } from "./tokens";

describe("theme tokens", () => {
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });

  for (const [name, t] of Object.entries(themes)) {
    describe(name, () => {
      it("body text meets AAA on ground and surface", () => {
        expect(contrastRatio(t.ink, t.ground)).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(t.ink, t.surface)).toBeGreaterThanOrEqual(7);
      });
      it("secondary and partner text meet AA", () => {
        expect(contrastRatio(t.muted, t.ground)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.partner, t.ground)).toBeGreaterThanOrEqual(4.5);
      });
      it("text on a cue fill is readable", () => {
        expect(contrastRatio(t.onCue, t.cue)).toBeGreaterThanOrEqual(4.5);
      });
      it("the cue light is visible (fill or its ink border meets 3:1)", () => {
        const fill = contrastRatio(t.cue, t.ground);
        const border = contrastRatio(t.ink, t.ground);
        expect(Math.max(fill, border)).toBeGreaterThanOrEqual(3);
      });
    });
  }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/styles/tokens.test.ts`
Expected: FAIL, cannot find module `./tokens`.

- [ ] **Step 3: Implement tokens**

`src/styles/tokens.ts`:

```ts
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
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/styles/tokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Global styles**

`src/app/globals.css`:

```css
@import "tailwindcss";

:root,
[data-theme="light"] {
  --ground: #eef1f4;
  --surface: #fafbfc;
  --ink: #15233b;
  --muted: #4a5a70;
  --cue: #f2a93b;
  --on-cue: #15233b;
  --partner: #2d5b86;
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    --ground: #101826;
    --surface: #172234;
    --ink: #e8edf4;
    --muted: #a9b6c8;
    --cue: #f5b656;
    --on-cue: #101826;
    --partner: #8db8e3;
    color-scheme: dark;
  }
}

[data-theme="dark"] {
  --ground: #101826;
  --surface: #172234;
  --ink: #e8edf4;
  --muted: #a9b6c8;
  --cue: #f5b656;
  --on-cue: #101826;
  --partner: #8db8e3;
  color-scheme: dark;
}

[data-theme="contrast"] {
  --ground: #000000;
  --surface: #000000;
  --ink: #ffffff;
  --muted: #ffffff;
  --cue: #ffd166;
  --on-cue: #000000;
  --partner: #ffffff;
  color-scheme: dark;
}

@theme inline {
  --color-ground: var(--ground);
  --color-surface: var(--surface);
  --color-ink: var(--ink);
  --color-muted: var(--muted);
  --color-cue: var(--cue);
  --color-on-cue: var(--on-cue);
  --color-partner: var(--partner);
  --font-sans: var(--font-atkinson), system-ui, sans-serif;
  --radius-control: 14px;
  --text-caption: 2rem;
  --text-caption--line-height: 2.5rem;
  --text-reply: 1.5rem;
  --text-reply--line-height: 2rem;
  --text-body: 1.25rem;
  --text-body--line-height: 1.875rem;
  --text-label: 1rem;
  --text-label--line-height: 1.5rem;
}

html {
  background: var(--ground);
}

body {
  background: var(--ground);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 1.25rem;
  line-height: 1.5;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

/* Two-ring focus: 2px ink inside (visible on light), 3px amber outside. */
:focus-visible {
  outline: 3px solid var(--cue);
  outline-offset: 2px;
  box-shadow: 0 0 0 2px var(--ink);
}

[data-theme="contrast"] :is(button, a, input, select, textarea) {
  outline: 3px solid var(--cue);
  outline-offset: 2px;
}

.skip-link {
  position: absolute;
  left: 1rem;
  top: -10rem;
  z-index: 50;
  padding: 0.75rem 1rem;
  border-radius: var(--radius-control);
  background: var(--ink);
  color: var(--ground);
  font-weight: 700;
}
.skip-link:focus {
  top: 1rem;
}

@layer components {
  .conv-grid {
    display: grid;
    gap: 1.5rem;
    grid-template-areas: "context" "log" "side";
  }
  @media (min-width: 64rem) {
    .conv-grid {
      grid-template-columns: minmax(0, 1fr) minmax(0, 36rem);
      grid-template-rows: auto 1fr;
      grid-template-areas: "log context" "log side";
    }
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 6: Root layout**

`src/app/layout.tsx`:

```tsx
import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next } from "next/font/google";
import "./globals.css";

const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin", "latin-ext"],
  variable: "--font-atkinson",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OnBeat",
  description: "Suggested spoken replies for people who communicate by typing.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EEF1F4" },
    { media: "(prefers-color-scheme: dark)", color: "#101826" },
  ],
};

// Applies a saved theme before first paint so the page doesn't flash.
const THEME_SCRIPT = `try{var t=localStorage.getItem("onbeat:theme");if(t&&t!=="system")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: THEME_SCRIPT may add data-theme before hydration.
    <html lang="en" className={atkinson.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <a href="#replies" className="skip-link">
          Skip to replies
        </a>
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Placeholder page**

`src/app/page.tsx` (replaced in Task 13):

```tsx
export default function Home() {
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-caption font-bold">OnBeat</h1>
      <p className="text-body text-muted">The conversation screen is coming in the next tasks.</p>
      <div id="replies" tabIndex={-1} />
    </main>
  );
}
```

Delete the unused generated assets:

```bash
rm -f public/next.svg public/vercel.svg public/file.svg public/globe.svg public/window.svg
```

- [ ] **Step 8: Verify**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Add theme tokens, Atkinson Hyperlegible Next and app shell

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Domain types, text helpers, language pack, context line

**Files:**
- Create: `src/lib/types.ts`, `src/lib/text.ts`, `src/lib/text.test.ts`, `src/lib/context.ts`, `src/lib/context.test.ts`, `src/lib/language-packs/types.ts`, `src/lib/language-packs/en.ts`, `src/lib/worker-like.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `NoteKind`, `Note`, `TimeOfDay`, `Phrase`, `ConversationContext`, `Turn`, `Reply`
  - `text.ts`: `normalize(s: string): string`, `tokenize(s: string): string[]`
  - `context.ts`: `timeOfDay(d: Date): TimeOfDay`, `contextLine(ctx: ConversationContext, getNote: (id: string) => Note | undefined, locale?: string): string`
  - `language-packs/types.ts`: `Reaction`, `VoiceOption`, `LanguagePack`
  - `language-packs/en.ts`: `en: LanguagePack`
  - `worker-like.ts`: `WorkerLike`

- [ ] **Step 1: Types (no test needed; exercised by later tests)**

`src/lib/types.ts`:

```ts
export type NoteKind = "person" | "place" | "routine" | "preference" | "about-me";

export interface Note {
  id: string;
  kind: NoteKind;
  text: string;
  /** Proper names in the note, e.g. ["Sam", "Blue Door Café"]. */
  entities: string[];
  updatedAt: number;
}

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export interface Phrase {
  id: string;
  text: string;
  context: { placeId?: string; partnerId?: string; timeOfDay: TimeOfDay };
  timesUsed: number;
  lastUsed: number;
}

export interface ConversationContext {
  now: Date;
  /** Id of a note of kind "place". */
  placeId?: string;
  /** Id of a note of kind "person". */
  partnerId?: string;
}

export interface Turn {
  id: string;
  speaker: "partner" | "user";
  text: string;
  at: number;
}

export interface Reply {
  text: string;
  noteIds: string[];
  source: "model" | "phrase";
}
```

`src/lib/worker-like.ts`:

```ts
/** The part of the Worker API we use, so tests can pass fakes. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
  terminate(): void;
}
```

- [ ] **Step 2: Write failing text helper tests**

`src/lib/text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalize, tokenize } from "./text";

describe("normalize", () => {
  it("lowercases, strips accents and unifies apostrophes", () => {
    expect(normalize("Café")).toBe("cafe");
    expect(normalize("Zoë")).toBe("zoe");
    expect(normalize("O’Brien")).toBe("o'brien");
  });
});

describe("tokenize", () => {
  it("splits on anything that isn't a letter, digit or apostrophe", () => {
    expect(tokenize("Hi Sam, a large oat-milk latte!")).toEqual(["hi", "sam", "a", "large", "oat", "milk", "latte"]);
  });
  it("keeps times together", () => {
    expect(tokenize("at 9:30 please")).toEqual(["at", "9:30", "please"]);
  });
  it("returns an empty list for blank input", () => {
    expect(tokenize("   ")).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to see failure**

Run: `npx vitest run src/lib/text.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement text helpers**

`src/lib/text.ts`:

```ts
/** Lowercase, remove diacritics, turn curly apostrophes into straight ones. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’‘]/g, "'")
    .toLowerCase();
}

/** Word tokens of normalized text. Times like 9:30 stay one token. */
export function tokenize(s: string): string[] {
  return normalize(s).match(/\d+(?::\d+)?|[\p{L}\d]+(?:'[\p{L}]+)*/gu) ?? [];
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/text.test.ts`
Expected: PASS.

- [ ] **Step 6: Language pack**

`src/lib/language-packs/types.ts`:

```ts
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
```

`src/lib/language-packs/en.ts`:

```ts
import type { LanguagePack } from "./types";

export const en: LanguagePack = {
  id: "en",
  name: "English",
  tier: "generative",
  bcp47: "en-US",
  maxWords: 15,
  simpleMaxWords: 10,
  reactions: [
    { id: "really", text: "Really?" },
    { id: "oh-no", text: "Oh no" },
    { id: "ha", text: "Ha!" },
    { id: "mm-hmm", text: "Mm-hmm" },
    { id: "yes", text: "Yes" },
    { id: "no", text: "No" },
    { id: "thanks", text: "Thank you" },
    { id: "sorry", text: "Sorry" },
    { id: "wow", text: "Wow" },
    { id: "nice", text: "Nice" },
    { id: "agree", text: "I agree" },
    { id: "not-sure", text: "I'm not sure" },
    { id: "go-on", text: "Go on" },
    { id: "thats-great", text: "That's great" },
    { id: "oh-dear", text: "Oh dear" },
    { id: "same", text: "Same here" },
    { id: "hmm", text: "Hmm" },
    { id: "exactly", text: "Exactly" },
    { id: "wait", text: "Wait a moment" },
    { id: "typing", text: "One second, I'm typing" },
  ],
  voices: [
    { id: "af_heart", label: "Heart", description: "Warm, higher pitch, American English" },
    { id: "af_bella", label: "Bella", description: "Bright and lively, higher pitch, American English" },
    { id: "af_nicole", label: "Nicole", description: "Soft and close, like speaking quietly, American English" },
    { id: "am_michael", label: "Michael", description: "Calm, lower pitch, American English" },
    { id: "am_fenrir", label: "Fenrir", description: "Deep and steady, lower pitch, American English" },
    { id: "am_puck", label: "Puck", description: "Friendly, middle pitch, American English" },
    { id: "bf_emma", label: "Emma", description: "Clear, higher pitch, British English" },
  ],
  defaultVoice: "af_heart",
};
```

- [ ] **Step 7: Write failing context tests**

`src/lib/context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { contextLine, timeOfDay } from "./context";
import type { Note } from "./types";

const notes: Record<string, Note> = {
  cafe: { id: "cafe", kind: "place", text: "Blue Door Café is my local coffee shop.", entities: ["Blue Door Café"], updatedAt: 0 },
  sam: { id: "sam", kind: "person", text: "Sam is the barista.", entities: ["Sam"], updatedAt: 0 },
};
const get = (id: string) => notes[id];

describe("timeOfDay", () => {
  it.each([
    [5, "morning"],
    [11, "morning"],
    [12, "afternoon"],
    [16, "afternoon"],
    [17, "evening"],
    [21, "evening"],
    [22, "night"],
    [3, "night"],
  ] as const)("hour %i is %s", (hour, expected) => {
    expect(timeOfDay(new Date(2026, 8, 29, hour))).toBe(expected);
  });
});

describe("contextLine", () => {
  it("describes day, time, place and partner", () => {
    const line = contextLine({ now: new Date(2026, 8, 29, 8), placeId: "cafe", partnerId: "sam" }, get);
    expect(line).toBe("It is Tuesday morning. Place: Blue Door Café. Talking with: Sam.");
  });
  it("leaves out unknown place and partner", () => {
    expect(contextLine({ now: new Date(2026, 8, 29, 20) }, get)).toBe("It is Tuesday evening.");
  });
});
```

- [ ] **Step 8: Run to see failure**

Run: `npx vitest run src/lib/context.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 9: Implement context helpers**

`src/lib/context.ts`:

```ts
import type { ConversationContext, Note, TimeOfDay } from "./types";

export function timeOfDay(d: Date): TimeOfDay {
  const h = d.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

function nameOf(note: Note | undefined): string | undefined {
  if (!note) return undefined;
  return note.entities[0] ?? note.text;
}

export function contextLine(
  ctx: ConversationContext,
  getNote: (id: string) => Note | undefined,
  locale = "en-US",
): string {
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(ctx.now);
  const parts = [`It is ${weekday} ${timeOfDay(ctx.now)}.`];
  const place = ctx.placeId ? nameOf(getNote(ctx.placeId)) : undefined;
  const partner = ctx.partnerId ? nameOf(getNote(ctx.partnerId)) : undefined;
  if (place) parts.push(`Place: ${place}.`);
  if (partner) parts.push(`Talking with: ${partner}.`);
  return parts.join(" ");
}
```

- [ ] **Step 10: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all pass.

```bash
git add -A
git commit -m "Add domain types, text helpers, English language pack and context line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Reply validator

**Files:**
- Create: `src/lib/suggest/validate.ts`, `src/lib/suggest/validate.test.ts`

**Interfaces:**
- Consumes: `normalize`, `tokenize` from `@/lib/text`.
- Produces:
  - `extractClaims(text: string): string[]`
  - `claimSupported(claim: string, sourceText: string): boolean`
  - `interface ValidationSources { notes: Map<string, string>; partnerSaid: string; typed: string }`
  - `type ValidationResult = { ok: true } | { ok: false; reason: "unknown-note" | "unsupported-detail"; detail: string }`
  - `validateReply(reply: { text: string; noteIds: string[] }, sources: ValidationSources): ValidationResult`
  - `isNearDuplicate(a: string, b: string): boolean`

Rules (from spec section 5): cited note ids must exist; names, numbers, days and times in a reply must appear in the cited notes, the partner's words or the typed text. Known limitation, documented in code: a capitalised word at the very start of a sentence is not treated as a name (it could be "Large, please."), except day and month names, which are always checked.

- [ ] **Step 1: Write the failing tests**

`src/lib/suggest/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { claimSupported, extractClaims, isNearDuplicate, validateReply, type ValidationSources } from "./validate";

const sources = (over: Partial<ValidationSources> = {}): ValidationSources => ({
  notes: new Map([
    ["sam", "Sam is the barista at Blue Door Café."],
    ["physio", "I have physio on Tuesdays at 10.30."],
    ["zoe", "Zoe O’Brien is my neighbour."],
  ]),
  partnerSaid: "",
  typed: "",
  ...over,
});

describe("extractClaims", () => {
  it("finds names after the first word, numbers, times and days", () => {
    expect(extractClaims("Thanks Sam, see you Friday at 9:30.")).toEqual(["9:30", "Sam", "Friday"]);
  });
  it("ignores sentence-initial capitals that aren't days or months", () => {
    expect(extractClaims("Large, please.")).toEqual([]);
    expect(extractClaims("Coffee sounds good. Thanks!")).toEqual([]);
  });
  it("always checks days and months, even first in a sentence", () => {
    expect(extractClaims("Monday works.")).toEqual(["Monday"]);
  });
  it("does not treat I or OK as names", () => {
    expect(extractClaims("Yes, I think OK is fine and I'm happy.")).toEqual([]);
  });
});

describe("claimSupported", () => {
  it("matches names ignoring accents, case and apostrophe style", () => {
    expect(claimSupported("Café", "blue door cafe")).toBe(true);
    expect(claimSupported("Zoë", "Zoe is here")).toBe(true);
    expect(claimSupported("O'Brien", "Zoe O’Brien")).toBe(true);
  });
  it("matches possessives", () => {
    expect(claimSupported("Sam's", "Sam is the barista")).toBe(true);
  });
  it("matches times written with a dot or colon", () => {
    expect(claimSupported("10:30", "physio at 10.30")).toBe(true);
    expect(claimSupported("11:30", "physio at 10.30")).toBe(false);
  });
});

describe("validateReply", () => {
  it("accepts a reply whose details come from cited notes", () => {
    expect(validateReply({ text: "Hi Sam, my usual please.", noteIds: ["sam"] }, sources())).toEqual({ ok: true });
  });
  it("rejects an unknown note id", () => {
    expect(validateReply({ text: "Hi!", noteIds: ["ghost"] }, sources())).toEqual({ ok: false, reason: "unknown-note", detail: "ghost" });
  });
  it("rejects a name that no source mentions", () => {
    expect(validateReply({ text: "Say hi to Priya for me.", noteIds: [] }, sources())).toEqual({
      ok: false,
      reason: "unsupported-detail",
      detail: "Priya",
    });
  });
  it("requires the note to be cited, not just sent", () => {
    expect(validateReply({ text: "Thanks, Sam.", noteIds: [] }, sources()).ok).toBe(false);
  });
  it("accepts details from what the partner said or what the user typed", () => {
    expect(validateReply({ text: "Yes, Friday works.", noteIds: [] }, sources({ partnerSaid: "Is Friday OK?" })).ok).toBe(true);
    expect(validateReply({ text: "See you at 4.", noteIds: [] }, sources({ typed: "4" })).ok).toBe(true);
  });
  it("rejects an invented time", () => {
    expect(validateReply({ text: "My physio is at 11:30.", noteIds: ["physio"] }, sources()).ok).toBe(false);
  });
  it("handles accented and apostrophe names from notes", () => {
    expect(validateReply({ text: "Tell Zoë O'Brien I said hi.", noteIds: ["zoe"] }, sources()).ok).toBe(true);
  });
});

describe("isNearDuplicate", () => {
  it("catches identical and nearly identical replies", () => {
    expect(isNearDuplicate("Large, please.", "large please")).toBe(true);
    expect(isNearDuplicate("A large latte, please.", "A large latte please thanks")).toBe(true);
  });
  it("keeps different replies", () => {
    expect(isNearDuplicate("Large, please.", "What sizes do you have?")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `npx vitest run src/lib/suggest/validate.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/lib/suggest/validate.ts`:

```ts
import { normalize, tokenize } from "@/lib/text";

const DAYS_AND_MONTHS = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
]);

const NEVER_NAMES = new Set(["i", "i'm", "i'll", "i've", "i'd", "ok", "okay"]);

const NUMBER = /\d+(?:[:.]\d+)?/g;
const WORD = /[\p{L}][\p{L}'’-]*/gu;

function canonicalNumber(n: string): string {
  return n.replace(".", ":");
}

/**
 * Details that must be backed by a source: numbers and times, day and month
 * names anywhere, and capitalised words after the first word of a sentence.
 * Limitation: a name as the very first word of a sentence is not detected,
 * because it can't be told apart from an ordinary capitalised word
 * ("Large, please.") without a dictionary.
 */
export function extractClaims(text: string): string[] {
  const claims: string[] = [];
  for (const m of text.matchAll(NUMBER)) claims.push(canonicalNumber(m[0]));
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const words = sentence.match(WORD) ?? [];
    words.forEach((word, i) => {
      const n = normalize(word).replace(/'s$/, "");
      if (NEVER_NAMES.has(n)) return;
      if (DAYS_AND_MONTHS.has(n)) {
        claims.push(word.replace(/['’]s$/, ""));
        return;
      }
      if (i > 0 && /^\p{Lu}/u.test(word)) claims.push(word.replace(/['’]s$/, ""));
    });
  }
  return claims;
}

export function claimSupported(claim: string, sourceText: string): boolean {
  if (/^\d/.test(claim)) {
    const numbers = [...sourceText.matchAll(NUMBER)].map((m) => canonicalNumber(m[0]));
    return numbers.includes(canonicalNumber(claim));
  }
  const target = normalize(claim).replace(/'s$/, "");
  const words = (normalize(sourceText).match(WORD) ?? []).flatMap((w) => [w, w.replace(/'s$/, "")]);
  if (words.includes(target)) return true;
  // Days in notes are often plural ("Tuesdays").
  return DAYS_AND_MONTHS.has(target) && words.includes(`${target}s`);
}

export interface ValidationSources {
  notes: Map<string, string>;
  partnerSaid: string;
  typed: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: "unknown-note" | "unsupported-detail"; detail: string };

export function validateReply(reply: { text: string; noteIds: string[] }, sources: ValidationSources): ValidationResult {
  for (const id of reply.noteIds) {
    if (!sources.notes.has(id)) return { ok: false, reason: "unknown-note", detail: id };
  }
  const sourceText = [...reply.noteIds.map((id) => sources.notes.get(id) ?? ""), sources.partnerSaid, sources.typed].join("\n");
  for (const claim of extractClaims(reply.text)) {
    if (!claimSupported(claim, sourceText)) return { ok: false, reason: "unsupported-detail", detail: claim };
  }
  return { ok: true };
}

export function isNearDuplicate(a: string, b: string): boolean {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return ta.size === tb.size;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = ta.size + tb.size - shared;
  return shared / union >= 0.6 && (shared === ta.size || shared === tb.size || shared / union >= 0.8);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/suggest/validate.test.ts`
Expected: PASS. If a duplicate case fails, adjust only `isNearDuplicate` thresholds so both "catches" and "keeps" tests pass.

- [ ] **Step 5: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add -A
git commit -m "Add reply validator that rejects invented names, numbers, days and times

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Memory store

**Files:**
- Create: `src/lib/memory/persist.ts`, `src/lib/memory/store.ts`, `src/lib/memory/store.test.ts`

**Interfaces:**
- Consumes: `Note`, `Phrase`, `ConversationContext` from `@/lib/types`; `normalize`, `tokenize` from `@/lib/text`; `timeOfDay` from `@/lib/context`.
- Produces:
  - `persist.ts`: `interface Snapshot { version: 1; notes: Note[]; phrases: Phrase[] }`, `interface Persist { readonly durable: boolean; load(): Promise<Snapshot | null>; save(s: Snapshot): Promise<void> }`, `memoryPersist(): Persist`
  - `store.ts`: `interface Embedder { embed(texts: string[]): Promise<number[][]> }`, `EMBED_DIMS = 384`, class `MemoryStore` with:
    - `static create(opts?: { embedder?: Embedder | null; persist?: Persist; now?: () => number; queryEmbedTimeoutMs?: number }): Promise<MemoryStore>`
    - `notes(): Note[]`, `phrases(): Phrase[]`, `getNote(id: string): Note | undefined`
    - `upsertNote(note: Note): Promise<void>`, `removeNote(id: string): Promise<void>`
    - `replaceAll(notes: Note[], phrases: Phrase[]): Promise<void>`
    - `addPhrase(text: string, ctx: ConversationContext): Promise<Phrase>`
    - `searchNotes(query: string, ctx: ConversationContext, k?: number): Promise<Note[]>`
    - `matchPhrases(prefix: string, k?: number): Phrase[]`
    - `styleExamples(query: string, k?: number): string[]`
    - `whenVectorsReady(): Promise<void>`
    - `readonly isDurable: boolean`

Behaviour:
- Notes are indexed as text immediately; vectors are added in the background when an embedder is available. Search works with or without vectors.
- `searchNotes`: hybrid search when the query can be embedded within `queryEmbedTimeoutMs` (default 300), else full-text. The current place and partner notes are always included first. Notes whose entities mention the place or partner names are always included and get a 1.5x boost.
- `matchPhrases`: every typed token must be the start of some word in the phrase. Ranked by times used, then recency.
- `styleExamples`: token overlap with the query plus a recency bonus.
- Every mutation saves a snapshot through `Persist`.

- [ ] **Step 1: Persistence interface**

`src/lib/memory/persist.ts`:

```ts
import type { Note, Phrase } from "@/lib/types";

export interface Snapshot {
  version: 1;
  notes: Note[];
  phrases: Phrase[];
}

export interface Persist {
  /** False when data only lives for this session. */
  readonly durable: boolean;
  load(): Promise<Snapshot | null>;
  save(snapshot: Snapshot): Promise<void>;
}

export function memoryPersist(): Persist {
  let snap: Snapshot | null = null;
  return {
    durable: false,
    async load() {
      return snap ? structuredClone(snap) : null;
    },
    async save(s) {
      snap = structuredClone(s);
    },
  };
}
```

- [ ] **Step 2: Write the failing tests**

`src/lib/memory/store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MemoryStore, type Embedder } from "./store";
import { memoryPersist } from "./persist";
import type { Note, Phrase } from "@/lib/types";

const note = (id: string, kind: Note["kind"], text: string, entities: string[] = []): Note => ({ id, kind, text, entities, updatedAt: 0 });

const NOTES: Note[] = [
  note("cafe", "place", "Blue Door Café is my local coffee shop.", ["Blue Door Café"]),
  note("sam", "person", "Sam is the barista at Blue Door Café.", ["Sam", "Blue Door Café"]),
  note("usual", "preference", "My usual order at Blue Door Café is a large oat milk latte.", ["Blue Door Café"]),
  note("physio", "routine", "I have physio on Tuesdays at 10:30.", []),
  note("dog", "person", "Biscuit is my dog, a golden retriever.", ["Biscuit"]),
];

const phrase = (id: string, text: string, timesUsed: number, lastUsed: number): Phrase => ({
  id,
  text,
  context: { timeOfDay: "morning" },
  timesUsed,
  lastUsed,
});

/** Deterministic fake: a 384-dim vector with a 1 at a slot derived from keywords. */
const fakeEmbedder: Embedder = {
  async embed(texts) {
    return texts.map((t) => {
      const v = new Array(384).fill(0);
      v[/dog|biscuit|walk/i.test(t) ? 1 : 0] = 1;
      return v;
    });
  },
};

const ctx = { now: new Date(2026, 8, 29, 8) };

describe("MemoryStore", () => {
  it("stores notes and finds them by text", async () => {
    const m = await MemoryStore.create();
    await m.replaceAll(NOTES, []);
    const hits = await m.searchNotes("physio", ctx);
    expect(hits[0]?.id).toBe("physio");
  });

  it("always includes the current place and partner first, then related notes", async () => {
    const m = await MemoryStore.create();
    await m.replaceAll(NOTES, []);
    const hits = await m.searchNotes("what size would you like", { ...ctx, placeId: "cafe", partnerId: "sam" });
    const ids = hits.map((n) => n.id);
    expect(ids.slice(0, 2).sort()).toEqual(["cafe", "sam"]);
    expect(ids).toContain("usual");
    expect(ids).not.toContain("dog");
  });

  it("uses vectors for meaning when an embedder is available", async () => {
    const m = await MemoryStore.create({ embedder: fakeEmbedder });
    await m.replaceAll(NOTES, []);
    await m.whenVectorsReady();
    const hits = await m.searchNotes("going for a walk", ctx);
    expect(hits.map((n) => n.id)).toContain("dog");
  });

  it("falls back to text search when the embedder fails", async () => {
    const broken: Embedder = { embed: async () => Promise.reject(new Error("no model")) };
    const m = await MemoryStore.create({ embedder: broken });
    await m.replaceAll(NOTES, []);
    await m.whenVectorsReady();
    expect((await m.searchNotes("physio", ctx))[0]?.id).toBe("physio");
  });

  it("returns at most k notes", async () => {
    const m = await MemoryStore.create();
    await m.replaceAll(NOTES, []);
    expect((await m.searchNotes("blue door", { ...ctx, placeId: "cafe" }, 2)).length).toBe(2);
  });

  it("matches phrases by word prefixes, most used first", async () => {
    const m = await MemoryStore.create();
    await m.replaceAll([], [phrase("a", "My usual, please.", 1, 10), phrase("b", "My usual latte please", 5, 5), phrase("c", "See you soon", 9, 9)]);
    expect(m.matchPhrases("my us").map((p) => p.id)).toEqual(["b", "a"]);
    expect(m.matchPhrases("")).toEqual([]);
  });

  it("adds phrases and counts repeats", async () => {
    let t = 1000;
    const m = await MemoryStore.create({ now: () => t });
    const p1 = await m.addPhrase("Large, please.", { ...ctx, placeId: "cafe" });
    t = 2000;
    const p2 = await m.addPhrase("large please", ctx);
    expect(p2.id).toBe(p1.id);
    expect(p2.timesUsed).toBe(2);
    expect(p2.lastUsed).toBe(2000);
    expect(m.phrases()).toHaveLength(1);
  });

  it("picks style examples by overlap and recency", async () => {
    const m = await MemoryStore.create({ now: () => 100 * 86_400_000 });
    await m.replaceAll([], [
      phrase("old", "A large latte would be lovely", 1, 0),
      phrase("new", "Coffee sounds great", 1, 100 * 86_400_000),
      phrase("other", "See you at physio", 1, 100 * 86_400_000),
    ]);
    const ex = m.styleExamples("large latte", 2);
    expect(ex[0]).toBe("A large latte would be lovely");
    expect(ex).toHaveLength(2);
  });

  it("persists and reloads", async () => {
    const persist = memoryPersist();
    const a = await MemoryStore.create({ persist });
    await a.replaceAll(NOTES, [phrase("p", "Hello", 1, 1)]);
    await a.removeNote("dog");
    const b = await MemoryStore.create({ persist });
    expect(b.notes().map((n) => n.id).sort()).toEqual(["cafe", "physio", "sam", "usual"]);
    expect(b.phrases()).toHaveLength(1);
    expect(await b.searchNotes("physio", ctx)).toHaveLength(1);
  });

  it("updates a note in place", async () => {
    const m = await MemoryStore.create();
    await m.replaceAll(NOTES, []);
    await m.upsertNote(note("physio", "routine", "I have physio on Thursdays at 2.", []));
    expect(m.getNote("physio")?.text).toContain("Thursdays");
    expect((await m.searchNotes("thursdays", ctx))[0]?.id).toBe("physio");
  });
});
```

- [ ] **Step 3: Run to see failure**

Run: `npx vitest run src/lib/memory/store.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement the store**

`src/lib/memory/store.ts`:

```ts
import { create, insert, remove, search, type AnyOrama } from "@orama/orama";
import { timeOfDay } from "@/lib/context";
import { normalize, tokenize } from "@/lib/text";
import type { ConversationContext, Note, Phrase } from "@/lib/types";
import { memoryPersist, type Persist } from "./persist";

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBED_DIMS = 384;
const DAY = 86_400_000;

function createIndex(): AnyOrama {
  return create({
    schema: { text: "string", entities: "string[]", embedding: `vector[${EMBED_DIMS}]` },
  }) as AnyOrama;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}

export class MemoryStore {
  private notesById = new Map<string, Note>();
  private phrasesById = new Map<string, Phrase>();
  private index: AnyOrama = createIndex();
  private vectorJob: Promise<void> = Promise.resolve();

  private constructor(
    private readonly embedder: Embedder | null,
    private readonly persist: Persist,
    private readonly now: () => number,
    private readonly queryEmbedTimeoutMs: number,
  ) {}

  static async create(
    opts: { embedder?: Embedder | null; persist?: Persist; now?: () => number; queryEmbedTimeoutMs?: number } = {},
  ): Promise<MemoryStore> {
    const store = new MemoryStore(
      opts.embedder ?? null,
      opts.persist ?? memoryPersist(),
      opts.now ?? Date.now,
      opts.queryEmbedTimeoutMs ?? 300,
    );
    const snap = await store.persist.load();
    if (snap) await store.load(snap.notes, snap.phrases);
    return store;
  }

  get isDurable(): boolean {
    return this.persist.durable;
  }

  notes(): Note[] {
    return [...this.notesById.values()];
  }

  phrases(): Phrase[] {
    return [...this.phrasesById.values()];
  }

  getNote(id: string): Note | undefined {
    return this.notesById.get(id);
  }

  whenVectorsReady(): Promise<void> {
    return this.vectorJob;
  }

  async replaceAll(notes: Note[], phrases: Phrase[]): Promise<void> {
    await this.load(notes, phrases);
    await this.save();
  }

  async upsertNote(note: Note): Promise<void> {
    if (this.notesById.has(note.id)) await remove(this.index, note.id);
    this.notesById.set(note.id, note);
    await insert(this.index, { id: note.id, text: note.text, entities: note.entities });
    this.queueVectors([note]);
    await this.save();
  }

  async removeNote(id: string): Promise<void> {
    if (!this.notesById.has(id)) return;
    this.notesById.delete(id);
    await remove(this.index, id);
    await this.save();
  }

  async addPhrase(text: string, ctx: ConversationContext): Promise<Phrase> {
    const clean = text.trim();
    const key = tokenize(clean).join(" ");
    const existing = [...this.phrasesById.values()].find((p) => tokenize(p.text).join(" ") === key);
    const context = { placeId: ctx.placeId, partnerId: ctx.partnerId, timeOfDay: timeOfDay(ctx.now) };
    const phrase: Phrase = existing
      ? { ...existing, timesUsed: existing.timesUsed + 1, lastUsed: this.now(), context }
      : { id: `p_${crypto.randomUUID()}`, text: clean, context, timesUsed: 1, lastUsed: this.now() };
    this.phrasesById.set(phrase.id, phrase);
    await this.save();
    return phrase;
  }

  async searchNotes(query: string, ctx: ConversationContext, k = 8): Promise<Note[]> {
    const scores = new Map<string, number>();
    const q = query.trim();
    if (q) {
      const vector = this.embedder ? await withTimeout(this.embedder.embed([q]), this.queryEmbedTimeoutMs) : null;
      const result = vector?.[0]
        ? await search(this.index, {
            mode: "hybrid",
            term: q,
            vector: { value: vector[0], property: "embedding" },
            similarity: 0.2,
            limit: 30,
          })
        : await search(this.index, { term: q, properties: ["text", "entities"], limit: 30, tolerance: 1 });
      for (const hit of result.hits) scores.set(String(hit.id), hit.score);
    }

    const contextIds = [ctx.placeId, ctx.partnerId].filter((id): id is string => !!id && this.notesById.has(id));
    const contextNames = new Set(contextIds.flatMap((id) => this.notesById.get(id)!.entities.map(normalize)));

    for (const note of this.notesById.values()) {
      if (contextIds.includes(note.id)) continue;
      if (note.entities.some((e) => contextNames.has(normalize(e)))) {
        scores.set(note.id, Math.max(scores.get(note.id) ?? 0, 0.5) * 1.5);
      }
    }

    const ranked = [...scores.entries()]
      .filter(([id]) => !contextIds.includes(id) && this.notesById.has(id))
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => this.notesById.get(id)!);
    return [...contextIds.map((id) => this.notesById.get(id)!), ...ranked].slice(0, k);
  }

  matchPhrases(prefix: string, k = 3): Phrase[] {
    const typed = tokenize(prefix);
    if (typed.length === 0) return [];
    return [...this.phrasesById.values()]
      .filter((p) => {
        const words = tokenize(p.text);
        return typed.every((t) => words.some((w) => w.startsWith(t)));
      })
      .sort((a, b) => b.timesUsed - a.timesUsed || b.lastUsed - a.lastUsed)
      .slice(0, k);
  }

  styleExamples(query: string, k = 5): string[] {
    const q = new Set(tokenize(query));
    const now = this.now();
    return [...this.phrasesById.values()]
      .map((p) => {
        const words = new Set(tokenize(p.text));
        let overlap = 0;
        for (const w of q) if (words.has(w)) overlap++;
        const recency = 0.3 * Math.exp(-(now - p.lastUsed) / (30 * DAY));
        return { text: p.text, score: overlap / Math.max(q.size, 1) + recency };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => x.text);
  }

  private async load(notes: Note[], phrases: Phrase[]): Promise<void> {
    this.notesById = new Map(notes.map((n) => [n.id, n]));
    this.phrasesById = new Map(phrases.map((p) => [p.id, p]));
    this.index = createIndex();
    for (const n of notes) await insert(this.index, { id: n.id, text: n.text, entities: n.entities });
    this.queueVectors(notes);
  }

  private queueVectors(notes: Note[]): void {
    const embedder = this.embedder;
    if (!embedder || notes.length === 0) return;
    const index = this.index;
    this.vectorJob = this.vectorJob.then(async () => {
      try {
        const vectors = await embedder.embed(notes.map((n) => n.text));
        for (const [i, n] of notes.entries()) {
          if (this.index !== index || this.notesById.get(n.id) !== n) continue;
          await remove(index, n.id);
          await insert(index, { id: n.id, text: n.text, entities: n.entities, embedding: vectors[i] });
        }
      } catch {
        // Embeddings are optional. Text search keeps working without them.
      }
    });
  }

  private async save(): Promise<void> {
    await this.persist.save({ version: 1, notes: this.notes(), phrases: this.phrases() });
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/memory/store.test.ts`
Expected: PASS. If Orama's TypeScript types reject the dynamic schema or `hit.id`, keep the runtime behaviour and add the narrowest cast needed.

- [ ] **Step 6: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add -A
git commit -m "Add on-device memory store with hybrid search and phrase history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Browser adapters for memory (embedder worker and IndexedDB)

**Files:**
- Create: `src/workers/embedder.worker.ts`, `src/lib/memory/worker-embedder.ts`, `src/lib/memory/worker-embedder.test.ts`, `src/lib/memory/idb-persist.ts`, `src/lib/memory/idb-persist.test.ts`, `src/lib/memory/browser.ts`

**Interfaces:**
- Consumes: `Embedder`, `MemoryStore` (Task 5); `Persist`, `Snapshot`, `memoryPersist` (Task 5); `WorkerLike` (Task 3).
- Produces:
  - `class WorkerEmbedder implements Embedder` with `constructor(worker: WorkerLike, timeoutMs?: number)`
  - `createBrowserEmbedder(): WorkerEmbedder | null`
  - `idbPersist(): Persist`, `detectPersist(): Promise<Persist>`
  - `getBrowserMemory(): Promise<MemoryStore>` (singleton)
  - Worker protocol: request `{ id: number; texts: string[] }`, response `{ id: number; vectors: number[][] } | { id: number; error: string }`

- [ ] **Step 1: Write failing WorkerEmbedder tests**

`src/lib/memory/worker-embedder.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { WorkerEmbedder } from "./worker-embedder";
import type { WorkerLike } from "@/lib/worker-like";

class FakeWorker implements WorkerLike {
  sent: { id: number; texts: string[] }[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage(m: unknown) {
    this.sent.push(m as { id: number; texts: string[] });
  }
  terminate() {}
  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

describe("WorkerEmbedder", () => {
  it("matches responses to requests by id", async () => {
    const w = new FakeWorker();
    const e = new WorkerEmbedder(w);
    const a = e.embed(["a"]);
    const b = e.embed(["b"]);
    w.reply({ id: w.sent[1].id, vectors: [[2]] });
    w.reply({ id: w.sent[0].id, vectors: [[1]] });
    expect(await a).toEqual([[1]]);
    expect(await b).toEqual([[2]]);
  });

  it("rejects on worker error", async () => {
    const w = new FakeWorker();
    const e = new WorkerEmbedder(w);
    const p = e.embed(["x"]);
    w.reply({ id: w.sent[0].id, error: "model failed" });
    await expect(p).rejects.toThrow("model failed");
  });

  it("times out", async () => {
    vi.useFakeTimers();
    const w = new FakeWorker();
    const e = new WorkerEmbedder(w, 1000);
    const p = e.embed(["x"]);
    vi.advanceTimersByTime(1001);
    await expect(p).rejects.toThrow("timed out");
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `npx vitest run src/lib/memory/worker-embedder.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement worker and client**

`src/workers/embedder.worker.ts`:

```ts
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

env.allowLocalModels = false;

// pipeline()'s overloads are too complex for TypeScript here; narrow them.
type Factory = (
  task: "feature-extraction",
  model: string,
  options: { dtype: "q8"; device: "wasm" },
) => Promise<FeatureExtractionPipeline>;
const createExtractor = pipeline as unknown as Factory;

let extractor: Promise<FeatureExtractionPipeline> | null = null;

self.onmessage = async (event: MessageEvent<{ id: number; texts: string[] }>) => {
  const { id, texts } = event.data;
  try {
    extractor ??= createExtractor("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8", device: "wasm" });
    const fe = await extractor;
    const out = await fe(texts, { pooling: "mean", normalize: true });
    self.postMessage({ id, vectors: out.tolist() as number[][] });
  } catch (err) {
    extractor = null;
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
```

`src/lib/memory/worker-embedder.ts`:

```ts
import type { WorkerLike } from "@/lib/worker-like";
import type { Embedder } from "./store";

type Pending = { resolve: (v: number[][]) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export class WorkerEmbedder implements Embedder {
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(
    private readonly worker: WorkerLike,
    private readonly timeoutMs = 60_000,
  ) {
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as { id: number; vectors?: number[][]; error?: string };
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      clearTimeout(p.timer);
      if (data.error !== undefined) p.reject(new Error(data.error));
      else p.resolve(data.vectors ?? []);
    };
  }

  embed(texts: string[]): Promise<number[][]> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error("Embedding timed out"));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, texts });
    });
  }
}

export function createBrowserEmbedder(): WorkerEmbedder | null {
  if (typeof Worker === "undefined") return null;
  const worker = new Worker(new URL("../../workers/embedder.worker.ts", import.meta.url), { type: "module" });
  return new WorkerEmbedder(worker);
}
```

The 60 s timeout covers the first model download (about 23 MB). Query-time embedding has its own 300 ms limit inside `MemoryStore`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/memory/worker-embedder.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing IndexedDB persistence test**

`src/lib/memory/idb-persist.test.ts`:

```ts
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { detectPersist, idbPersist } from "./idb-persist";

describe("idbPersist", () => {
  it("saves and loads a snapshot", async () => {
    const p = idbPersist();
    expect(p.durable).toBe(true);
    await p.save({ version: 1, notes: [], phrases: [{ id: "a", text: "Hi", context: { timeOfDay: "morning" }, timesUsed: 1, lastUsed: 1 }] });
    const again = idbPersist();
    expect((await again.load())?.phrases[0]?.text).toBe("Hi");
  });

  it("detectPersist returns a durable store when IndexedDB works", async () => {
    expect((await detectPersist()).durable).toBe(true);
  });
});
```

- [ ] **Step 6: Implement IndexedDB persistence and the browser singleton**

`src/lib/memory/idb-persist.ts`:

```ts
import { createStore, get, set } from "idb-keyval";
import { memoryPersist, type Persist, type Snapshot } from "./persist";

const KEY = "snapshot";

export function idbPersist(): Persist {
  const store = createStore("onbeat", "memory");
  return {
    durable: true,
    async load() {
      return (await get<Snapshot>(KEY, store)) ?? null;
    },
    async save(snapshot) {
      await set(KEY, snapshot, store);
    },
  };
}

/** IndexedDB when available (not in some private windows), otherwise session memory. */
export async function detectPersist(): Promise<Persist> {
  try {
    const p = idbPersist();
    await p.load();
    return p;
  } catch {
    return memoryPersist();
  }
}
```

`src/lib/memory/browser.ts`:

```ts
import { detectPersist } from "./idb-persist";
import { MemoryStore } from "./store";
import { createBrowserEmbedder } from "./worker-embedder";

let memory: Promise<MemoryStore> | null = null;

export function getBrowserMemory(): Promise<MemoryStore> {
  memory ??= detectPersist().then((persist) => MemoryStore.create({ persist, embedder: createBrowserEmbedder() }));
  return memory;
}
```

- [ ] **Step 7: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all pass (the build confirms Turbopack bundles the worker).

```bash
git add -A
git commit -m "Add embedding worker and IndexedDB persistence for memory

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Request protocol, prompt and stream line parser

**Files:**
- Create: `src/lib/suggest/protocol.ts`, `src/lib/suggest/protocol.test.ts`, `src/lib/suggest/prompt.ts`, `src/lib/suggest/prompt.test.ts`

**Interfaces:**
- Produces:
  - `SuggestRequestSchema` (Zod) and `type SuggestRequestBody` with fields `mode: "replies" | "replies+reactions"`, `typed`, `partnerSaid`, `contextLine`, `notes: { id; text }[]`, `examples: string[]`, `reactions: { id; text }[]`, `maxWords: number`, `preferProvider?: "groq" | "cerebras"`
  - `type ParsedLine = { kind: "reply"; text: string; noteIds: string[] } | { kind: "reactions"; ids: string[] } | { kind: "invalid"; raw: string }`
  - `parseLine(raw: string): ParsedLine | null`
  - `createLineSplitter(onLine: (line: string) => void): { push(chunk: string): void; flush(): void }`
  - `type ChatMessage = { role: "system" | "user"; content: string }`, `buildMessages(body: SuggestRequestBody): ChatMessage[]`

Wire format: the model writes one JSON object per line: `{"reply": "...", "notes": ["id"]}` three times, then (in `replies+reactions` mode) `{"reactions": ["id", "id"]}`.

- [ ] **Step 1: Write failing protocol tests**

`src/lib/suggest/protocol.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createLineSplitter, parseLine, SuggestRequestSchema } from "./protocol";

describe("parseLine", () => {
  it("parses reply lines", () => {
    expect(parseLine('{"reply": "Large, please.", "notes": ["n1"]}')).toEqual({ kind: "reply", text: "Large, please.", noteIds: ["n1"] });
  });
  it("defaults missing notes to an empty list", () => {
    expect(parseLine('{"reply": "Hi"}')).toEqual({ kind: "reply", text: "Hi", noteIds: [] });
  });
  it("parses reactions", () => {
    expect(parseLine('{"reactions": ["ha", "really"]}')).toEqual({ kind: "reactions", ids: ["ha", "really"] });
  });
  it("ignores blank lines and flags junk", () => {
    expect(parseLine("   ")).toBeNull();
    expect(parseLine("```json")).toEqual({ kind: "invalid", raw: "```json" });
    expect(parseLine('{"reply": ')).toEqual({ kind: "invalid", raw: '{"reply":' });
    expect(parseLine('{"other": 1}')).toEqual({ kind: "invalid", raw: '{"other": 1}' });
  });
});

describe("createLineSplitter", () => {
  it("emits complete lines across chunk boundaries and flushes the rest", () => {
    const lines: string[] = [];
    const s = createLineSplitter((l) => lines.push(l));
    s.push('{"reply": "A"}\n{"re');
    s.push('ply": "B"}\n{"reply"');
    expect(lines).toEqual(['{"reply": "A"}', '{"reply": "B"}']);
    s.push(': "C"}');
    s.flush();
    expect(lines).toEqual(['{"reply": "A"}', '{"reply": "B"}', '{"reply": "C"}']);
  });
});

describe("SuggestRequestSchema", () => {
  const valid = {
    mode: "replies",
    typed: "",
    partnerSaid: "What size?",
    contextLine: "It is Tuesday morning.",
    notes: [{ id: "n1", text: "Note" }],
    examples: [],
    reactions: [{ id: "ha", text: "Ha!" }],
    maxWords: 15,
  };
  it("accepts a valid body", () => {
    expect(SuggestRequestSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects oversized fields", () => {
    expect(SuggestRequestSchema.safeParse({ ...valid, typed: "x".repeat(501) }).success).toBe(false);
    expect(SuggestRequestSchema.safeParse({ ...valid, notes: Array.from({ length: 13 }, (_, i) => ({ id: `n${i}`, text: "t" })) }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `npx vitest run src/lib/suggest/protocol.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement protocol**

`src/lib/suggest/protocol.ts`:

```ts
import { z } from "zod";

export const SuggestRequestSchema = z.object({
  mode: z.enum(["replies", "replies+reactions"]),
  typed: z.string().max(500),
  partnerSaid: z.string().max(1000),
  contextLine: z.string().max(300),
  notes: z.array(z.object({ id: z.string().max(64), text: z.string().max(300) })).max(12),
  examples: z.array(z.string().max(200)).max(5),
  reactions: z.array(z.object({ id: z.string().max(32), text: z.string().max(60) })).max(30),
  maxWords: z.number().int().min(5).max(25),
  preferProvider: z.enum(["groq", "cerebras"]).optional(),
});

export type SuggestRequestBody = z.infer<typeof SuggestRequestSchema>;

const ReplyLine = z.object({ reply: z.string().min(1).max(200), notes: z.array(z.string()).default([]) });
const ReactionsLine = z.object({ reactions: z.array(z.string()).max(4) });

export type ParsedLine =
  | { kind: "reply"; text: string; noteIds: string[] }
  | { kind: "reactions"; ids: string[] }
  | { kind: "invalid"; raw: string };

export function parseLine(raw: string): ParsedLine | null {
  const line = raw.trim();
  if (!line) return null;
  if (!line.startsWith("{")) return { kind: "invalid", raw: line };
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return { kind: "invalid", raw: line };
  }
  const reply = ReplyLine.safeParse(json);
  if (reply.success) return { kind: "reply", text: reply.data.reply.trim(), noteIds: reply.data.notes };
  const reactions = ReactionsLine.safeParse(json);
  if (reactions.success) return { kind: "reactions", ids: reactions.data.reactions };
  return { kind: "invalid", raw: line };
}

export function createLineSplitter(onLine: (line: string) => void) {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf("\n")) >= 0) {
        onLine(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
      }
    },
    flush() {
      if (buffer.trim()) onLine(buffer);
      buffer = "";
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/suggest/protocol.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing prompt tests**

`src/lib/suggest/prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildMessages } from "./prompt";
import type { SuggestRequestBody } from "./protocol";

const body: SuggestRequestBody = {
  mode: "replies+reactions",
  typed: "large",
  partnerSaid: "What size would you like?",
  contextLine: "It is Tuesday morning. Place: Blue Door Café. Talking with: Sam.",
  notes: [{ id: "usual", text: "My usual is a large oat milk latte." }],
  examples: ["My usual, please."],
  reactions: [{ id: "ha", text: "Ha!" }],
  maxWords: 15,
};

describe("buildMessages", () => {
  it("puts everything the model needs in the user message", () => {
    const [system, user] = buildMessages(body);
    expect(system.role).toBe("system");
    expect(user.role).toBe("user");
    for (const s of ["What size would you like?", '"large"', "[usual] My usual is a large oat milk latte.", "- My usual, please.", "at most 15 words", "ha: Ha!", '{"reactions"']) {
      expect(user.content).toContain(s);
    }
  });

  it("leaves reactions out in replies mode", () => {
    const [, user] = buildMessages({ ...body, mode: "replies" });
    expect(user.content).not.toContain("reactions");
  });

  it("says when there are no notes or examples", () => {
    const [, user] = buildMessages({ ...body, notes: [], examples: [], typed: "", partnerSaid: "" });
    expect(user.content).toContain("(none)");
    expect(user.content).toContain("(nothing yet)");
  });
});
```

- [ ] **Step 6: Implement the prompt**

`src/lib/suggest/prompt.ts`:

```ts
import type { SuggestRequestBody } from "./protocol";

export type ChatMessage = { role: "system" | "user"; content: string };

export function buildMessages(b: SuggestRequestBody): ChatMessage[] {
  const withReactions = b.mode === "replies+reactions";
  const notes = b.notes.length ? b.notes.map((n) => `[${n.id}] ${n.text}`).join("\n") : "(none)";
  const examples = b.examples.length ? b.examples.map((e) => `- ${e}`).join("\n") : "(none)";

  const lines = [
    "You help a person who cannot speak take part in a live spoken conversation. You write short replies they can choose to say out loud.",
    "",
    `Situation: ${b.contextLine}`,
    `The other person just said: ${b.partnerSaid ? `"${b.partnerSaid}"` : "(nothing yet)"}`,
    `The person has typed so far: ${b.typed ? `"${b.typed}"` : "(nothing yet)"}`,
    "",
    "Notes about the person's life. Use only these facts:",
    notes,
    "",
    "Things the person has said before. Match their style:",
    examples,
    "",
    "Rules:",
    "- Write exactly 3 replies, in first person, as the person.",
    `- Each reply is at most ${b.maxWords} words, plain and natural.`,
    "- The 3 replies must say different things, for example a direct answer, an answer with one detail, and an alternative.",
    "- If the person has typed something, every reply must keep that meaning.",
    "- Only mention names, places, numbers, days or times that appear in the notes, in what the other person said, or in what the person typed. Never invent them.",
    "- For each reply, list the ids of the notes it uses.",
  ];

  if (withReactions) {
    lines.push(
      "- Also pick the 2 reactions from this list that best fit what the other person said:",
      b.reactions.map((r) => `${r.id}: ${r.text}`).join("\n"),
    );
  }

  lines.push(
    "",
    "Output format: one JSON object per line and nothing else. No markdown, no explanations.",
    '{"reply": "...", "notes": ["note-id"]}',
    '{"reply": "...", "notes": []}',
    '{"reply": "...", "notes": []}',
  );
  if (withReactions) lines.push('{"reactions": ["id", "id"]}');

  return [
    { role: "system", content: "You write short, first-person spoken replies. Follow the output format exactly." },
    { role: "user", content: lines.join("\n") },
  ];
}
```

- [ ] **Step 7: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add -A
git commit -m "Add suggestion request schema, prompt builder and line parser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Server route with provider fallback

**Files:**
- Create: `src/lib/server/sse.ts`, `src/lib/server/sse.test.ts`, `src/lib/server/providers.ts`, `src/lib/server/providers.test.ts`, `src/lib/server/rate-limit.ts`, `src/lib/server/rate-limit.test.ts`, `src/app/api/suggest/route.ts`, `src/app/api/suggest/route.test.ts`

**Interfaces:**
- Consumes: `SuggestRequestSchema`, `buildMessages`, `ChatMessage` (Task 7).
- Produces:
  - `readSSEData(body: ReadableStream<Uint8Array>): AsyncGenerator<string>`, `contentDelta(data: string): string`
  - `type ProviderId = "groq" | "cerebras"`, `providerConfigs(env?): Record<ProviderId, ProviderConfig>`, `streamCompletion(messages, opts): Promise<{ provider: ProviderId; deltas: AsyncGenerator<string> }>`, `class AllProvidersFailedError`
  - `createRateLimiter({ limit, windowMs, now? }): { check(key: string): boolean }`
  - `POST /api/suggest`: 200 `text/plain` stream of model text with header `x-onbeat-provider`; 400 invalid, 403 cross-origin, 413 too large, 429 rate limited, 503 all providers failed.

Provider settings (checked 2026-09-27): Groq `https://api.groq.com/openai/v1/chat/completions` model `qwen/qwen3.8-27b`; Cerebras `https://api.cerebras.ai/v1/chat/completions` model `qwen-3.8-27b`. Both accept `reasoning_effort: "none"` to switch thinking off. Models can be overridden with `GROQ_MODEL` and `CEREBRAS_MODEL`.

- [ ] **Step 1: Write failing SSE tests**

`src/lib/server/sse.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { contentDelta, readSSEData } from "./sse";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

describe("readSSEData", () => {
  it("yields data payloads across chunk boundaries and stops at DONE", async () => {
    const out: string[] = [];
    for await (const d of readSSEData(streamOf(["data: {\"a\":1}\n\nda", "ta: {\"b\":2}\r\n\n: comment\ndata: [DONE]\n\ndata: late\n\n"]))) out.push(d);
    expect(out).toEqual(['{"a":1}', '{"b":2}']);
  });
});

describe("contentDelta", () => {
  it("extracts delta content and ignores reasoning or junk", () => {
    expect(contentDelta('{"choices":[{"delta":{"content":"Hi"}}]}')).toBe("Hi");
    expect(contentDelta('{"choices":[{"delta":{"reasoning":"hmm"}}]}')).toBe("");
    expect(contentDelta("not json")).toBe("");
  });
});
```

- [ ] **Step 2: Implement SSE helpers**

`src/lib/server/sse.ts`:

```ts
/** Yields the payload of each `data:` line of an OpenAI-style event stream. */
export async function* readSSEData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i).replace(/\r$/, "");
        buffer = buffer.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        if (data) yield data;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function contentDelta(data: string): string {
  try {
    const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
    return json.choices?.[0]?.delta?.content ?? "";
  } catch {
    return "";
  }
}
```

Run: `npx vitest run src/lib/server/sse.test.ts` and expect PASS.

- [ ] **Step 3: Write failing provider tests**

`src/lib/server/providers.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AllProvidersFailedError, providerConfigs, streamCompletion } from "./providers";

const configs = providerConfigs({ GROQ_API_KEY: "g", CEREBRAS_API_KEY: "c" } as NodeJS.ProcessEnv);
const messages = [{ role: "user" as const, content: "hi" }];

function sse(parts: string[], delayMs = 0): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(c) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      for (const p of parts) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

async function collect(gen: AsyncGenerator<string>) {
  let s = "";
  for await (const d of gen) s += d;
  return s;
}

describe("streamCompletion", () => {
  it("streams from the first provider", async () => {
    const fetchImpl = vi.fn(async () => sse(["Hel", "lo"]));
    const r = await streamCompletion(messages, { order: ["groq", "cerebras"], configs, fetchImpl });
    expect(r.provider).toBe("groq");
    expect(await collect(r.deltas)).toBe("Hello");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("api.groq.com");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "qwen/qwen3.8-27b", stream: true, reasoning_effort: "none" });
  });

  it("falls back on HTTP 429", async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.includes("groq") ? new Response("busy", { status: 429 }) : sse(["ok"])));
    const r = await streamCompletion(messages, { order: ["groq", "cerebras"], configs, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.provider).toBe("cerebras");
    expect(await collect(r.deltas)).toBe("ok");
  });

  it("falls back when the first token is too slow", async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.includes("groq") ? sse(["late"], 200) : sse(["fast"])));
    const r = await streamCompletion(messages, { order: ["groq", "cerebras"], configs, fetchImpl: fetchImpl as unknown as typeof fetch, firstTokenTimeoutMs: 50 });
    expect(r.provider).toBe("cerebras");
  });

  it("skips providers without a key", async () => {
    const onlyCerebras = providerConfigs({ CEREBRAS_API_KEY: "c" } as NodeJS.ProcessEnv);
    const fetchImpl = vi.fn(async () => sse(["x"]));
    const r = await streamCompletion(messages, { order: ["groq", "cerebras"], configs: onlyCerebras, fetchImpl });
    expect(r.provider).toBe("cerebras");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws when every provider fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    await expect(streamCompletion(messages, { order: ["groq", "cerebras"], configs, fetchImpl })).rejects.toBeInstanceOf(AllProvidersFailedError);
  });
});
```

- [ ] **Step 4: Implement providers**

`src/lib/server/providers.ts`:

```ts
import type { ChatMessage } from "@/lib/suggest/prompt";
import { contentDelta, readSSEData } from "./sse";

export type ProviderId = "groq" | "cerebras";

export interface ProviderConfig {
  id: ProviderId;
  url: string;
  model: string;
  apiKey: string | undefined;
}

export function providerConfigs(env: NodeJS.ProcessEnv = process.env): Record<ProviderId, ProviderConfig> {
  return {
    groq: {
      id: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: env.GROQ_MODEL ?? "qwen/qwen3.8-27b",
      apiKey: env.GROQ_API_KEY,
    },
    cerebras: {
      id: "cerebras",
      url: "https://api.cerebras.ai/v1/chat/completions",
      model: env.CEREBRAS_MODEL ?? "qwen-3.8-27b",
      apiKey: env.CEREBRAS_API_KEY,
    },
  };
}

export class AllProvidersFailedError extends Error {
  constructor(details: string) {
    super(`All providers failed: ${details}`);
    this.name = "AllProvidersFailedError";
  }
}

export interface StreamOptions {
  order: ProviderId[];
  configs: Record<ProviderId, ProviderConfig>;
  fetchImpl?: typeof fetch;
  firstTokenTimeoutMs?: number;
  signal?: AbortSignal;
}

async function firstContent(stream: AsyncGenerator<string>, deadline: number): Promise<string | null> {
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    const next = stream.next();
    next.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      next,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), remaining);
      }),
    ]);
    clearTimeout(timer);
    if (result === "timeout" || result.done) return null;
    const text = contentDelta(result.value);
    if (text) return text;
  }
}

async function* contentOnly(first: string, stream: AsyncGenerator<string>): AsyncGenerator<string> {
  yield first;
  for await (const data of stream) {
    const text = contentDelta(data);
    if (text) yield text;
  }
}

export async function streamCompletion(
  messages: ChatMessage[],
  opts: StreamOptions,
): Promise<{ provider: ProviderId; deltas: AsyncGenerator<string> }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.firstTokenTimeoutMs ?? 1500;
  const failures: string[] = [];

  for (const id of opts.order) {
    const cfg = opts.configs[id];
    if (!cfg.apiKey) {
      failures.push(`${id}: no key`);
      continue;
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const deadline = Date.now() + timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(cfg.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          stream: true,
          temperature: 0.6,
          max_tokens: 400,
          reasoning_effort: "none",
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        failures.push(`${id}: HTTP ${res.status}`);
        controller.abort();
        continue;
      }
      const stream = readSSEData(res.body);
      const first = await firstContent(stream, deadline);
      if (first === null) {
        failures.push(`${id}: no first token in ${timeoutMs} ms`);
        // Abort first so the pending read fails; never await return() on a stalled stream.
        controller.abort();
        stream.return(undefined).catch(() => {});
        continue;
      }
      clearTimeout(timer);
      return { provider: id, deltas: contentOnly(first, stream) };
    } catch (err) {
      failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
      controller.abort();
    } finally {
      clearTimeout(timer);
    }
  }
  throw new AllProvidersFailedError(failures.join("; "));
}
```

Run: `npx vitest run src/lib/server/providers.test.ts` and expect PASS.

- [ ] **Step 5: Rate limiter with tests**

`src/lib/server/rate-limit.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to the limit per window per key", () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
    expect(rl.check("a")).toBe(true);
    expect(rl.check("a")).toBe(true);
    expect(rl.check("a")).toBe(false);
    expect(rl.check("b")).toBe(true);
    t = 1001;
    expect(rl.check("a")).toBe(true);
  });
});
```

`src/lib/server/rate-limit.ts`:

```ts
export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();
  return {
    check(key: string): boolean {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < opts.windowMs);
      if (recent.length >= opts.limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > 5000) {
        for (const k of hits.keys()) {
          hits.delete(k);
          if (hits.size <= 4000) break;
        }
      }
      return true;
    },
  };
}
```

- [ ] **Step 6: Write failing route tests**

`src/app/api/suggest/route.test.ts`:

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const body = {
  mode: "replies",
  typed: "",
  partnerSaid: "What size?",
  contextLine: "It is Tuesday morning.",
  notes: [],
  examples: [],
  reactions: [],
  maxWords: 15,
};

let ip = 0;
function req(data: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/suggest", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", "x-forwarded-for": `10.0.0.${++ip}`, ...headers },
    body: typeof data === "string" ? data : JSON.stringify(data),
  });
}

function sseResponse(text: string): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`));
        c.close();
      },
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", "test-groq");
  vi.stubEnv("CEREBRAS_API_KEY", "test-cerebras");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/suggest", () => {
  it("streams model text with the provider header", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse('{"reply":"Large, please.","notes":[]}\n')));
    const res = await POST(req(body));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-onbeat-provider")).toBe("groq");
    expect(await res.text()).toBe('{"reply":"Large, please.","notes":[]}\n');
  });

  it("prefers cerebras when asked", async () => {
    const fetchMock = vi.fn(async () => sseResponse("x"));
    vi.stubGlobal("fetch", fetchMock);
    await POST(req({ ...body, preferProvider: "cerebras" }));
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("cerebras");
  });

  it("rejects invalid bodies and bad JSON", async () => {
    expect((await POST(req({ ...body, maxWords: 99 }))).status).toBe(400);
    expect((await POST(req("{nope"))).status).toBe(400);
  });

  it("rejects cross-origin requests", async () => {
    expect((await POST(req(body, { origin: "https://evil.example" }))).status).toBe(403);
  });

  it("rejects bodies over 16 KB", async () => {
    expect((await POST(req({ ...body, contextLine: "x".repeat(17_000) }))).status).toBe(413);
  });

  it("rate limits per IP", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse("x")));
    const headers = { "x-forwarded-for": "192.168.1.1" };
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await POST(req(body, headers))).status;
    expect(last).toBe(429);
  });

  it("returns 503 when all providers fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    const res = await POST(req(body));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });
});
```

- [ ] **Step 7: Implement the route**

`src/app/api/suggest/route.ts`:

```ts
import { AllProvidersFailedError, providerConfigs, streamCompletion, type ProviderId } from "@/lib/server/providers";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { buildMessages } from "@/lib/suggest/prompt";
import { SuggestRequestSchema } from "@/lib/suggest/protocol";

const MAX_BODY_CHARS = 16_000;
const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

function json(data: unknown, status: number): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return json({ error: "forbidden" }, 403);

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!limiter.check(ip)) return json({ error: "rate_limited" }, 429);

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return json({ error: "too_large" }, 413);

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const parsed = SuggestRequestSchema.safeParse(data);
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const order: ProviderId[] = parsed.data.preferProvider === "cerebras" ? ["cerebras", "groq"] : ["groq", "cerebras"];

  try {
    const { provider, deltas } = await streamCompletion(buildMessages(parsed.data), {
      order,
      configs: providerConfigs(),
      signal: request.signal,
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await deltas.next();
          if (done) controller.close();
          else controller.enqueue(encoder.encode(value));
        } catch {
          controller.close();
        }
      },
      async cancel() {
        await deltas.return(undefined);
      },
    });
    // Request content is never logged.
    return new Response(stream, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-onbeat-provider": provider,
      },
    });
  } catch (err) {
    if (err instanceof AllProvidersFailedError) return json({ error: "unavailable" }, 503);
    throw err;
  }
}
```

- [ ] **Step 8: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all pass.

```bash
git add -A
git commit -m "Add /api/suggest with Groq and Cerebras fallback, limits and validation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Live smoke test (only if keys are available)**

If `.env.local` contains real keys (the user adds them; never commit this file), run `npm run dev` and in another terminal:

```bash
curl -s -N -X POST http://localhost:3000/api/suggest -H "content-type: application/json" -d '{"mode":"replies+reactions","typed":"","partnerSaid":"What size would you like?","contextLine":"It is Tuesday morning. Place: Blue Door Café.","notes":[{"id":"usual","text":"My usual order is a large oat milk latte."}],"examples":[],"reactions":[{"id":"ha","text":"Ha!"},{"id":"thanks","text":"Thank you"}],"maxWords":15}'
```

Expected: three `{"reply": ...}` lines and one `{"reactions": ...}` line. If the model adds reasoning text or fences, record the exact output in the task report; the client tolerates junk lines, but the prompt may need tightening in plan 2's eval.

---

### Task 9: Suggestion client

**Files:**
- Create: `src/lib/suggest/client.ts`, `src/lib/suggest/client.test.ts`

**Interfaces:**
- Consumes: `MemoryStore` (Task 5), `LanguagePack`, `Reaction` (Task 3), `contextLine` (Task 3), `normalize` (Task 3), `validateReply`, `isNearDuplicate`, `ValidationSources` (Task 4), `parseLine`, `createLineSplitter`, `SuggestRequestBody` (Task 7), `Reply`, `ConversationContext` (Task 3).
- Produces:
  - `interface SuggestInput { mode: "replies" | "replies+reactions"; typed: string; partnerSaid: string; context: ConversationContext }`
  - `interface SuggestUpdate { replies: Reply[]; reactions: Reaction[]; done: boolean; provider?: string }`
  - `class SuggestUnavailableError extends Error`
  - `class SuggestClient` with `constructor(deps: { memory: MemoryStore; pack: LanguagePack; fetchImpl?: typeof fetch; endpoint?: string; simpleLanguage?: () => boolean })`, `request(input: SuggestInput, onUpdate: (u: SuggestUpdate) => void): Promise<SuggestUpdate | null>` (resolves `null` when superseded), `cancel(): void`

Behaviour: clamp typed to 500 chars and partner text to the last 1000; cache last 20 final results; a new request aborts the previous one; stream-parse lines, validate each reply, drop near-duplicates, keep at most 3 replies and 2 known reactions; if a response has no valid replies and at least one invalid line, retry once preferring the other provider; network or HTTP failure throws `SuggestUnavailableError`; a mid-stream failure keeps what was already received.

- [ ] **Step 1: Write the failing tests**

`src/lib/suggest/client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { SuggestClient, SuggestUnavailableError, type SuggestUpdate } from "./client";
import { MemoryStore } from "@/lib/memory/store";
import { en } from "@/lib/language-packs/en";
import type { Note } from "@/lib/types";

const NOTES: Note[] = [
  { id: "cafe", kind: "place", text: "Blue Door Café is my local coffee shop.", entities: ["Blue Door Café"], updatedAt: 0 },
  { id: "sam", kind: "person", text: "Sam is the barista at Blue Door Café.", entities: ["Sam", "Blue Door Café"], updatedAt: 0 },
];

async function memory() {
  const m = await MemoryStore.create();
  await m.replaceAll(NOTES, []);
  return m;
}

function streamResponse(lines: string[], opts: { provider?: string; failAfter?: number } = {}): Response {
  const enc = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (opts.failAfter !== undefined && i === opts.failAfter) {
        c.error(new Error("connection reset"));
        return;
      }
      if (i >= lines.length) {
        c.close();
        return;
      }
      c.enqueue(enc.encode(lines[i++] + "\n"));
    },
  });
  return new Response(body, { status: 200, headers: { "x-onbeat-provider": opts.provider ?? "groq" } });
}

const ctx = { now: new Date(2026, 8, 29, 8), placeId: "cafe", partnerId: "sam" };
const input = { mode: "replies+reactions" as const, typed: "", partnerSaid: "What size would you like?", context: ctx };

describe("SuggestClient", () => {
  it("streams validated replies and reactions", async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([
        '{"reply": "Large, please.", "notes": []}',
        '{"reply": "Hi Sam, my usual please.", "notes": ["sam"]}',
        '{"reply": "What sizes do you have?", "notes": []}',
        '{"reactions": ["mm-hmm", "not-a-reaction", "thanks"]}',
      ]),
    );
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl });
    const updates: SuggestUpdate[] = [];
    const final = await client.request(input, (u) => updates.push(u));
    expect(final?.replies.map((r) => r.text)).toEqual(["Large, please.", "Hi Sam, my usual please.", "What sizes do you have?"]);
    expect(final?.reactions.map((r) => r.id)).toEqual(["mm-hmm", "thanks"]);
    expect(final?.provider).toBe("groq");
    expect(updates[0].replies).toHaveLength(1);
    expect(updates.at(-1)?.done).toBe(true);
  });

  it("sends the context, notes and limits in the body", async () => {
    const fetchImpl = vi.fn(async () => streamResponse([]));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl, simpleLanguage: () => true });
    await client.request(input, () => {});
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.contextLine).toContain("Place: Blue Door Café. Talking with: Sam.");
    expect(body.notes.map((n: { id: string }) => n.id).slice(0, 2).sort()).toEqual(["cafe", "sam"]);
    expect(body.maxWords).toBe(en.simpleMaxWords);
  });

  it("drops invented details and duplicates", async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse(['{"reply": "Say hi to Priya.", "notes": []}', '{"reply": "Large, please.", "notes": []}', '{"reply": "large please", "notes": []}']),
    );
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl });
    const final = await client.request(input, () => {});
    expect(final?.replies.map((r) => r.text)).toEqual(["Large, please."]);
  });

  it("ignores junk lines", async () => {
    const fetchImpl = vi.fn(async () => streamResponse(["```json", "Sure! Here you go:", '{"reply": "Large, please."}', "```"]));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl });
    expect((await client.request(input, () => {}))?.replies).toHaveLength(1);
  });

  it("retries once on the other provider when output is all junk", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(streamResponse(["I cannot help with that."], { provider: "groq" }))
      .mockResolvedValueOnce(streamResponse(['{"reply": "Large, please."}'], { provider: "cerebras" }));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl });
    const final = await client.request(input, () => {});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body as string).preferProvider).toBe("cerebras");
    expect(final?.provider).toBe("cerebras");
  });

  it("keeps partial results on mid-stream failure", async () => {
    const fetchImpl = vi.fn(async () => streamResponse(['{"reply": "Large, please."}', '{"reply": "Medium."}'], { failAfter: 1 }));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl });
    expect((await client.request(input, () => {}))?.replies.map((r) => r.text)).toEqual(["Large, please."]);
  });

  it("throws SuggestUnavailableError on HTTP errors", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"unavailable"}', { status: 503 }));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl });
    await expect(client.request(input, () => {})).rejects.toBeInstanceOf(SuggestUnavailableError);
  });

  it("a newer request cancels the older one", async () => {
    let releaseFirst: (() => void) | undefined;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const { typed } = JSON.parse(init.body as string) as { typed: string };
      if (typed === "old") {
        await new Promise<void>((r) => (releaseFirst = r));
        if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
        return streamResponse(['{"reply": "Old."}']);
      }
      return streamResponse(['{"reply": "New."}']);
    });
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl: fetchImpl as unknown as typeof fetch });
    const seen: string[] = [];
    const first = client.request({ ...input, typed: "old" }, (u) => u.replies.forEach((r) => seen.push(r.text)));
    await vi.waitFor(() => expect(releaseFirst).toBeDefined());
    const second = client.request({ ...input, typed: "new" }, (u) => u.replies.forEach((r) => seen.push(r.text)));
    releaseFirst?.();
    expect(await first).toBeNull();
    expect((await second)?.replies[0].text).toBe("New.");
    expect(seen).not.toContain("Old.");
  });

  it("serves repeated requests from cache", async () => {
    const fetchImpl = vi.fn(async () => streamResponse(['{"reply": "Large, please."}']));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl });
    await client.request(input, () => {});
    const again = await client.request(input, () => {});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(again?.replies[0].text).toBe("Large, please.");
  });

  it("clamps long input", async () => {
    const fetchImpl = vi.fn(async () => streamResponse([]));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl });
    await client.request({ ...input, typed: "a".repeat(900), partnerSaid: "b".repeat(3000) }, () => {});
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.typed).toHaveLength(500);
    expect(body.partnerSaid).toHaveLength(1000);
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `npx vitest run src/lib/suggest/client.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/lib/suggest/client.ts`:

```ts
import { contextLine } from "@/lib/context";
import type { LanguagePack, Reaction } from "@/lib/language-packs/types";
import type { MemoryStore } from "@/lib/memory/store";
import { normalize } from "@/lib/text";
import type { ConversationContext, Reply } from "@/lib/types";
import { createLineSplitter, parseLine, type SuggestRequestBody } from "./protocol";
import { isNearDuplicate, validateReply, type ValidationSources } from "./validate";

export interface SuggestInput {
  mode: SuggestRequestBody["mode"];
  typed: string;
  partnerSaid: string;
  context: ConversationContext;
}

export interface SuggestUpdate {
  replies: Reply[];
  reactions: Reaction[];
  done: boolean;
  provider?: string;
}

export class SuggestUnavailableError extends Error {
  constructor(detail: string) {
    super(`Suggestions unavailable: ${detail}`);
    this.name = "SuggestUnavailableError";
  }
}

interface Deps {
  memory: MemoryStore;
  pack: LanguagePack;
  fetchImpl?: typeof fetch;
  endpoint?: string;
  simpleLanguage?: () => boolean;
}

interface StreamOutcome {
  replies: Reply[];
  reactions: Reaction[];
  invalid: number;
  provider?: string;
}

const CACHE_SIZE = 20;

export class SuggestClient {
  private controller: AbortController | null = null;
  private generation = 0;
  private cache = new Map<string, SuggestUpdate>();

  constructor(private readonly deps: Deps) {}

  cancel(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
  }

  async request(input: SuggestInput, onUpdate: (u: SuggestUpdate) => void): Promise<SuggestUpdate | null> {
    const typed = input.typed.slice(0, 500);
    const partnerSaid = input.partnerSaid.slice(-1000);
    const key = JSON.stringify([
      input.mode,
      normalize(typed.trim()),
      normalize(partnerSaid.trim()),
      input.context.placeId ?? "",
      input.context.partnerId ?? "",
    ]);

    this.cancel();
    const cached = this.cache.get(key);
    if (cached) {
      onUpdate(cached);
      return cached;
    }

    const controller = new AbortController();
    this.controller = controller;
    const generation = this.generation;
    const isCurrent = () => generation === this.generation && !controller.signal.aborted;

    const { memory, pack } = this.deps;
    const query = `${typed} ${partnerSaid}`.trim();
    const notes = await memory.searchNotes(query, input.context, 8);
    if (!isCurrent()) return null;

    const simple = this.deps.simpleLanguage?.() ?? false;
    const body: SuggestRequestBody = {
      mode: input.mode,
      typed,
      partnerSaid,
      contextLine: contextLine(input.context, (id) => memory.getNote(id)),
      notes: notes.map((n) => ({ id: n.id, text: n.text.slice(0, 300) })),
      examples: memory.styleExamples(query, 5).map((e) => e.slice(0, 200)),
      reactions: pack.reactions,
      maxWords: simple ? pack.simpleMaxWords : pack.maxWords,
    };
    const sources: ValidationSources = { notes: new Map(notes.map((n) => [n.id, n.text])), partnerSaid, typed };

    let outcome = await this.stream(body, sources, controller, isCurrent, onUpdate);
    if (outcome && outcome.replies.length === 0 && outcome.invalid > 0 && isCurrent()) {
      const other = outcome.provider === "cerebras" ? "groq" : "cerebras";
      outcome = await this.stream({ ...body, preferProvider: other }, sources, controller, isCurrent, onUpdate);
    }
    if (!outcome || !isCurrent()) return null;

    const final: SuggestUpdate = { replies: outcome.replies, reactions: outcome.reactions, done: true, provider: outcome.provider };
    onUpdate(final);
    this.cache.set(key, final);
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string);
    if (this.controller === controller) this.controller = null;
    return final;
  }

  private async stream(
    body: SuggestRequestBody,
    sources: ValidationSources,
    controller: AbortController,
    isCurrent: () => boolean,
    onUpdate: (u: SuggestUpdate) => void,
  ): Promise<StreamOutcome | null> {
    let res: Response;
    try {
      res = await (this.deps.fetchImpl ?? fetch)(this.deps.endpoint ?? "/api/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (!isCurrent()) return null;
      throw new SuggestUnavailableError(err instanceof Error ? err.message : "network error");
    }
    if (!isCurrent()) return null;
    if (!res.ok || !res.body) throw new SuggestUnavailableError(`HTTP ${res.status}`);

    const reactionsById = new Map(this.deps.pack.reactions.map((r) => [r.id, r]));
    const replies: Reply[] = [];
    let reactions: Reaction[] = [];
    let invalid = 0;

    const splitter = createLineSplitter((line) => {
      const parsed = parseLine(line);
      if (!parsed) return;
      if (parsed.kind === "invalid") {
        invalid++;
        return;
      }
      if (parsed.kind === "reactions") {
        reactions = parsed.ids.map((id) => reactionsById.get(id)).filter((r): r is Reaction => !!r).slice(0, 2);
      } else {
        if (replies.length >= 3) return;
        if (!validateReply({ text: parsed.text, noteIds: parsed.noteIds }, sources).ok) return;
        if (replies.some((r) => isNearDuplicate(r.text, parsed.text))) return;
        replies.push({ text: parsed.text, noteIds: parsed.noteIds, source: "model" });
      }
      if (isCurrent()) onUpdate({ replies: [...replies], reactions, done: false });
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!isCurrent()) {
          await reader.cancel().catch(() => {});
          return null;
        }
        splitter.push(decoder.decode(value, { stream: true }));
      }
      splitter.flush();
    } catch {
      if (!isCurrent()) return null;
      // Mid-stream failure: keep what already arrived.
    }
    return { replies, reactions, invalid, provider: res.headers.get("x-onbeat-provider") ?? undefined };
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/suggest/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add -A
git commit -m "Add suggestion client with streaming, validation, retry and cancellation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Voice engine

**Files:**
- Create: `src/lib/voice/messages.ts`, `src/lib/voice/engine.ts`, `src/lib/voice/engine.test.ts`, `src/lib/voice/browser.ts`, `src/workers/voice.worker.ts`

**Interfaces:**
- Consumes: `WorkerLike` (Task 3), `en` (Task 3).
- Produces:
  - `messages.ts`: `VoiceWorkerRequest`, `VoiceWorkerMessage`
  - `engine.ts`: `type VoiceMode = "loading" | "natural" | "basic"`, `interface AudioOut`, `interface BasicSpeech`, `class VoiceEngine` with `mode`, `current: string | null`, `load()`, `prepare(text)`, `speak(text): Promise<void>`, `stop()`, `on(event, cb): () => void` for events `start` (text), `end` (text), `mode` (VoiceMode), `progress` (0 to 100)
  - `browser.ts`: `webAudioOut(): AudioOut`, `browserBasicSpeech(lang?): BasicSpeech`, `getBrowserVoice(): VoiceEngine` (singleton), localStorage key `onbeat:voice`

Behaviour: natural voice only once the worker reports `ready`; until then and after a load error, the basic browser voice speaks. `speak` waits up to 1500 ms for a natural clip, then uses the basic voice. Speaking again stops the previous utterance first. `end` fires exactly once per `start`.

- [ ] **Step 1: Worker message types**

`src/lib/voice/messages.ts`:

```ts
export type VoiceWorkerRequest =
  | { type: "load" }
  | { type: "generate"; id: number; text: string; voice: string; speed: number };

export type VoiceWorkerMessage =
  | { type: "ready" }
  | { type: "progress"; value: number }
  | { type: "audio"; id: number; samples: Float32Array; sampleRate: number }
  | { type: "error"; id?: number; message: string };
```

- [ ] **Step 2: Write the failing tests**

`src/lib/voice/engine.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { VoiceEngine, type AudioOut, type BasicSpeech } from "./engine";
import type { VoiceWorkerMessage, VoiceWorkerRequest } from "./messages";
import type { WorkerLike } from "@/lib/worker-like";

class FakeWorker implements WorkerLike {
  sent: VoiceWorkerRequest[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage(m: unknown) {
    this.sent.push(m as VoiceWorkerRequest);
  }
  terminate() {}
  emit(m: VoiceWorkerMessage) {
    this.onmessage?.({ data: m } as MessageEvent);
  }
  lastGenerate() {
    return this.sent.filter((m) => m.type === "generate").at(-1) as Extract<VoiceWorkerRequest, { type: "generate" }>;
  }
}

function fakeAudio() {
  const played: number[] = [];
  let finish: (() => void) | null = null;
  const audio: AudioOut = {
    play: vi.fn((samples: Float32Array) => {
      played.push(samples.length);
      return new Promise<void>((r) => (finish = r));
    }),
    stop: vi.fn(() => finish?.()),
  };
  return { audio, played, finish: () => finish?.() };
}

function fakeBasic() {
  const spoken: string[] = [];
  const basic: BasicSpeech = { speak: vi.fn(async (t: string) => void spoken.push(t)), stop: vi.fn() };
  return { basic, spoken };
}

const deps = (worker: WorkerLike | null, audio: AudioOut, basic: BasicSpeech) => ({
  worker,
  audio,
  basic,
  voice: () => "af_heart",
  speed: () => 1,
  naturalWaitMs: 50,
});

describe("VoiceEngine", () => {
  it("uses the basic voice while loading", async () => {
    const w = new FakeWorker();
    const { audio } = fakeAudio();
    const { basic, spoken } = fakeBasic();
    const v = new VoiceEngine(deps(w, audio, basic));
    v.load();
    await v.speak("Hello");
    expect(spoken).toEqual(["Hello"]);
    expect(v.mode).toBe("loading");
  });

  it("switches to basic when there is no worker or loading fails", () => {
    const { audio } = fakeAudio();
    const { basic } = fakeBasic();
    const none = new VoiceEngine(deps(null, audio, basic));
    none.load();
    expect(none.mode).toBe("basic");

    const w = new FakeWorker();
    const modes: string[] = [];
    const v = new VoiceEngine(deps(w, audio, basic));
    v.on("mode", (m) => modes.push(m));
    v.load();
    w.emit({ type: "error", message: "download failed" });
    expect(v.mode).toBe("basic");
    expect(modes).toEqual(["basic"]);
  });

  it("prepares audio once and plays it from cache", async () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic } = fakeBasic();
    const v = new VoiceEngine(deps(w, a.audio, basic));
    v.load();
    w.emit({ type: "ready" });
    v.prepare("Large, please.");
    v.prepare("Large, please.");
    expect(w.sent.filter((m) => m.type === "generate")).toHaveLength(1);
    w.emit({ type: "audio", id: w.lastGenerate().id, samples: new Float32Array(10), sampleRate: 24000 });
    const done = v.speak("Large, please.");
    await vi.waitFor(() => expect(a.played).toEqual([10]));
    a.finish();
    await done;
  });

  it("falls back to basic when the natural clip is too slow", async () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic, spoken } = fakeBasic();
    const v = new VoiceEngine(deps(w, a.audio, basic));
    v.load();
    w.emit({ type: "ready" });
    await v.speak("Slow one");
    expect(spoken).toEqual(["Slow one"]);
  });

  it("speaking again stops the previous utterance", async () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic } = fakeBasic();
    const v = new VoiceEngine(deps(w, a.audio, basic));
    v.load();
    w.emit({ type: "ready" });
    const events: string[] = [];
    v.on("start", (t) => events.push(`start:${t}`));
    v.on("end", (t) => events.push(`end:${t}`));
    v.prepare("One");
    w.emit({ type: "audio", id: w.lastGenerate().id, samples: new Float32Array(5), sampleRate: 24000 });
    v.prepare("Two");
    w.emit({ type: "audio", id: w.lastGenerate().id, samples: new Float32Array(7), sampleRate: 24000 });
    const first = v.speak("One");
    await vi.waitFor(() => expect(a.played).toEqual([5]));
    const second = v.speak("Two");
    await first;
    await vi.waitFor(() => expect(a.played).toEqual([5, 7]));
    a.finish();
    await second;
    expect(events).toEqual(["start:One", "end:One", "start:Two", "end:Two"]);
    expect(v.current).toBeNull();
  });

  it("stop ends the current utterance once", async () => {
    const { audio } = fakeAudio();
    const basic: BasicSpeech = { speak: () => new Promise(() => {}), stop: vi.fn() };
    const v = new VoiceEngine(deps(null, audio, basic));
    v.load();
    const ends: string[] = [];
    v.on("end", (t) => ends.push(t));
    void v.speak("Hello");
    v.stop();
    v.stop();
    expect(ends).toEqual(["Hello"]);
    expect(basic.stop).toHaveBeenCalled();
  });

  it("reports load progress", () => {
    const w = new FakeWorker();
    const { audio } = fakeAudio();
    const { basic } = fakeBasic();
    const v = new VoiceEngine(deps(w, audio, basic));
    const progress: number[] = [];
    v.on("progress", (p) => progress.push(p));
    w.emit({ type: "progress", value: 42 });
    expect(progress).toEqual([42]);
  });
});
```

- [ ] **Step 3: Run to see failure**

Run: `npx vitest run src/lib/voice/engine.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement the engine**

`src/lib/voice/engine.ts`:

```ts
import type { WorkerLike } from "@/lib/worker-like";
import type { VoiceWorkerMessage } from "./messages";

export type VoiceMode = "loading" | "natural" | "basic";

export interface AudioOut {
  /** Resolves when playback finishes or is stopped. */
  play(samples: Float32Array, sampleRate: number): Promise<void>;
  stop(): void;
}

export interface BasicSpeech {
  /** Resolves when speech finishes, errors or is cancelled. */
  speak(text: string, rate: number): Promise<void>;
  stop(): void;
}

type Clip = { samples: Float32Array; sampleRate: number };
type Events = { start: string; end: string; mode: VoiceMode; progress: number };

export interface VoiceEngineDeps {
  worker: WorkerLike | null;
  audio: AudioOut;
  basic: BasicSpeech;
  voice: () => string;
  speed: () => number;
  naturalWaitMs?: number;
  cacheSize?: number;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export class VoiceEngine {
  mode: VoiceMode = "loading";
  private listeners: { [K in keyof Events]: Set<(v: Events[K]) => void> } = {
    start: new Set(),
    end: new Set(),
    mode: new Set(),
    progress: new Set(),
  };
  private clips = new Map<string, Promise<Clip>>();
  private pending = new Map<number, { resolve: (c: Clip) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private token = 0;
  private speaking: string | null = null;

  constructor(private readonly deps: VoiceEngineDeps) {
    if (deps.worker) deps.worker.onmessage = (e: MessageEvent) => this.onWorkerMessage(e.data as VoiceWorkerMessage);
  }

  get current(): string | null {
    return this.speaking;
  }

  on<K extends keyof Events>(event: K, cb: (v: Events[K]) => void): () => void {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  load(): void {
    if (!this.deps.worker) {
      this.setMode("basic");
      return;
    }
    this.deps.worker.postMessage({ type: "load" });
  }

  prepare(text: string): void {
    const t = text.trim();
    if (t && this.mode === "natural") this.clip(t).catch(() => {});
  }

  async speak(text: string): Promise<void> {
    const t = text.trim();
    if (!t) return;
    this.stop();
    const token = ++this.token;
    this.speaking = t;
    this.emit("start", t);
    try {
      const clip = this.mode === "natural" ? await withTimeout(this.clip(t), this.deps.naturalWaitMs ?? 1500) : null;
      if (token !== this.token) return;
      if (clip) await this.deps.audio.play(clip.samples, clip.sampleRate);
      else await this.deps.basic.speak(t, this.deps.speed());
    } finally {
      if (token === this.token && this.speaking === t) {
        this.speaking = null;
        this.emit("end", t);
      }
    }
  }

  stop(): void {
    const was = this.speaking;
    this.token++;
    this.speaking = null;
    this.deps.audio.stop();
    this.deps.basic.stop();
    if (was !== null) this.emit("end", was);
  }

  private emit<K extends keyof Events>(event: K, value: Events[K]): void {
    for (const cb of this.listeners[event]) cb(value);
  }

  private setMode(mode: VoiceMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.emit("mode", mode);
  }

  private clip(text: string): Promise<Clip> {
    const key = `${this.deps.voice()}|${this.deps.speed()}|${text}`;
    const existing = this.clips.get(key);
    if (existing) {
      this.clips.delete(key);
      this.clips.set(key, existing);
      return existing;
    }
    const id = this.nextId++;
    const promise = new Promise<Clip>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    promise.catch(() => this.clips.delete(key));
    this.clips.set(key, promise);
    while (this.clips.size > (this.deps.cacheSize ?? 30)) this.clips.delete(this.clips.keys().next().value as string);
    this.deps.worker?.postMessage({ type: "generate", id, text, voice: this.deps.voice(), speed: this.deps.speed() });
    return promise;
  }

  private onWorkerMessage(msg: VoiceWorkerMessage): void {
    switch (msg.type) {
      case "ready":
        this.setMode("natural");
        return;
      case "progress":
        this.emit("progress", msg.value);
        return;
      case "audio": {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        p.resolve({ samples: msg.samples, sampleRate: msg.sampleRate });
        return;
      }
      case "error": {
        if (msg.id === undefined) {
          this.setMode("basic");
          for (const p of this.pending.values()) p.reject(new Error(msg.message));
          this.pending.clear();
          this.clips.clear();
          return;
        }
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        p.reject(new Error(msg.message));
      }
    }
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/voice/engine.test.ts`
Expected: PASS.

- [ ] **Step 6: Worker and browser adapters**

`src/workers/voice.worker.ts`:

```ts
import { KokoroTTS } from "kokoro-js";
import type { VoiceWorkerMessage, VoiceWorkerRequest } from "@/lib/voice/messages";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
let tts: Promise<KokoroTTS> | null = null;

function post(message: VoiceWorkerMessage, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(message, transfer);
}

function load(): Promise<KokoroTTS> {
  // q8 on WebAssembly keeps the one-time download near 90 MB.
  tts ??= KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p) => {
      if (p.status === "progress") post({ type: "progress", value: Math.round(p.progress) });
    },
  });
  return tts;
}

self.onmessage = async (event: MessageEvent<VoiceWorkerRequest>) => {
  const msg = event.data;
  if (msg.type === "load") {
    try {
      await load();
      post({ type: "ready" });
    } catch (err) {
      tts = null;
      post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  try {
    const model = await load();
    const audio = await model.generate(msg.text, { voice: msg.voice as "af_heart", speed: msg.speed });
    const samples = audio.audio as Float32Array;
    post({ type: "audio", id: msg.id, samples, sampleRate: audio.sampling_rate }, [samples.buffer as ArrayBuffer]);
  } catch (err) {
    post({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
```

If TypeScript rejects `p.progress` because the progress type is a union, narrow with `"progress" in p && typeof p.progress === "number"`.

`src/lib/voice/browser.ts`:

```ts
import { en } from "@/lib/language-packs/en";
import { VoiceEngine, type AudioOut, type BasicSpeech } from "./engine";

export function webAudioOut(): AudioOut {
  let ctx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let finishCurrent: (() => void) | null = null;
  return {
    play(samples, sampleRate) {
      ctx ??= new AudioContext();
      void ctx.resume();
      this.stop();
      const buffer = ctx.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      source = node;
      return new Promise<void>((resolve) => {
        finishCurrent = resolve;
        node.onended = () => {
          if (source === node) source = null;
          resolve();
        };
        node.start();
      });
    },
    stop() {
      if (source) {
        const node = source;
        source = null;
        try {
          node.stop();
        } catch {
          // already stopped
        }
      }
      finishCurrent?.();
      finishCurrent = null;
    },
  };
}

export function browserBasicSpeech(lang = en.bcp47): BasicSpeech {
  return {
    speak(text, rate) {
      return new Promise<void>((resolve) => {
        if (typeof speechSynthesis === "undefined") {
          resolve();
          return;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        utterance.rate = rate;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        speechSynthesis.speak(utterance);
      });
    },
    stop() {
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    },
  };
}

function readVoice(): string {
  try {
    return localStorage.getItem("onbeat:voice") ?? en.defaultVoice;
  } catch {
    return en.defaultVoice;
  }
}

let engine: VoiceEngine | null = null;

export function getBrowserVoice(): VoiceEngine {
  if (engine) return engine;
  const worker =
    typeof Worker === "undefined" ? null : new Worker(new URL("../../workers/voice.worker.ts", import.meta.url), { type: "module" });
  engine = new VoiceEngine({ worker, audio: webAudioOut(), basic: browserBasicSpeech(), voice: readVoice, speed: () => 1 });
  return engine;
}
```

- [ ] **Step 7: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all pass.

```bash
git add -A
git commit -m "Add voice engine with Kokoro worker and browser speech fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Example personas

**Files:**
- Create: `src/data/personas.ts`, `src/data/personas.test.ts`

**Interfaces:**
- Consumes: `Note`, `Phrase` (Task 3).
- Produces: `interface Persona { id: string; name: string; summary: string; defaultPlaceId: string; defaultPartnerId: string; notes: Note[]; phrases: Phrase[] }`, `personas: Persona[]` (ids `maya`, `tom`, `aisha`).

- [ ] **Step 1: Write the failing test**

`src/data/personas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { personas } from "./personas";

describe("personas", () => {
  it("has the three example people", () => {
    expect(personas.map((p) => p.id)).toEqual(["maya", "tom", "aisha"]);
  });

  for (const p of personas) {
    describe(p.name, () => {
      const ids = new Set(p.notes.map((n) => n.id));
      it("has unique note and phrase ids", () => {
        expect(ids.size).toBe(p.notes.length);
        expect(new Set(p.phrases.map((x) => x.id)).size).toBe(p.phrases.length);
      });
      it("points defaults at a place and a person", () => {
        expect(p.notes.find((n) => n.id === p.defaultPlaceId)?.kind).toBe("place");
        expect(p.notes.find((n) => n.id === p.defaultPartnerId)?.kind).toBe("person");
      });
      it("only references existing notes from phrases", () => {
        for (const ph of p.phrases) {
          if (ph.context.placeId) expect(ids.has(ph.context.placeId)).toBe(true);
          if (ph.context.partnerId) expect(ids.has(ph.context.partnerId)).toBe(true);
        }
      });
      it("has no dash characters in visible text", () => {
        const text = [p.summary, ...p.notes.map((n) => n.text), ...p.phrases.map((x) => x.text)].join(" ");
        expect(text).not.toMatch(/[\u2013\u2014]/);
      });
    });
  }
});
```

- [ ] **Step 2: Implement the data**

`src/data/personas.ts`:

```ts
import type { Note, Phrase } from "@/lib/types";

export interface Persona {
  id: string;
  name: string;
  summary: string;
  defaultPlaceId: string;
  defaultPartnerId: string;
  notes: Note[];
  phrases: Phrase[];
}

const n = (id: string, kind: Note["kind"], text: string, entities: string[] = []): Note => ({ id, kind, text, entities, updatedAt: 0 });

const p = (id: string, text: string, timesUsed: number, placeId?: string, partnerId?: string): Phrase => ({
  id,
  text,
  context: { placeId, partnerId, timeOfDay: "morning" },
  timesUsed,
  lastUsed: 0,
});

export const personas: Persona[] = [
  {
    id: "maya",
    name: "Maya",
    summary: "Has ALS and hears fine. Ordering at her local café.",
    defaultPlaceId: "m-cafe",
    defaultPartnerId: "m-sam",
    notes: [
      n("m-me", "about-me", "I'm Maya. I have ALS, so I type to talk. I can hear fine.", ["Maya"]),
      n("m-cafe", "place", "Blue Door Café is my local coffee shop, two blocks from home.", ["Blue Door Café"]),
      n("m-sam", "person", "Sam is the barista at Blue Door Café and knows my usual order.", ["Sam", "Blue Door Café"]),
      n("m-usual", "preference", "My usual order at Blue Door Café is a large oat milk latte, no sugar.", ["Blue Door Café"]),
      n("m-physio", "routine", "I have physio on Tuesdays at 10:30."),
      n("m-leila", "person", "Leila is my daughter. She studies at university in Toronto.", ["Leila", "Toronto"]),
      n("m-biscuit", "person", "Biscuit is my dog, a golden retriever.", ["Biscuit"]),
      n("m-books", "preference", "I love mystery novels, especially Agatha Christie.", ["Agatha Christie"]),
      n("m-home", "place", "Home is my apartment on Cedar Street.", ["Cedar Street"]),
    ],
    phrases: [
      p("m-p1", "My usual, please.", 12, "m-cafe", "m-sam"),
      p("m-p2", "Could I get a large oat latte?", 6, "m-cafe"),
      p("m-p3", "Thanks Sam, have a good day.", 9, "m-cafe", "m-sam"),
      p("m-p4", "I'm doing well, thanks for asking.", 7),
      p("m-p5", "Give me a moment, I'm typing.", 5),
      p("m-p6", "Can I pay by card?", 4, "m-cafe"),
      p("m-p7", "Leila is doing great at school.", 3),
    ],
  },
  {
    id: "tom",
    name: "Tom",
    summary: "Deaf, uses ASL, and doesn't use his voice. Picking up a prescription.",
    defaultPlaceId: "t-pharmacy",
    defaultPartnerId: "t-priya",
    notes: [
      n("t-me", "about-me", "I'm Tom. I'm Deaf and I use ASL. I read captions to follow what people say.", ["Tom"]),
      n("t-pharmacy", "place", "Riverside Pharmacy is where I pick up my prescriptions.", ["Riverside Pharmacy"]),
      n("t-priya", "person", "Priya is the pharmacist at Riverside Pharmacy.", ["Priya", "Riverside Pharmacy"]),
      n("t-meds", "routine", "I pick up my blood pressure medication at Riverside Pharmacy every month.", ["Riverside Pharmacy"]),
      n("t-allergy", "about-me", "I'm allergic to penicillin."),
      n("t-doctor", "person", "Dr. Chen at Lakeview Clinic is my family doctor.", ["Dr. Chen", "Lakeview Clinic"]),
      n("t-work", "about-me", "I work as a graphic designer."),
    ],
    phrases: [
      p("t-p1", "I'm here to pick up a prescription.", 10, "t-pharmacy"),
      p("t-p2", "Can you type that for me?", 8),
      p("t-p3", "Is it ready?", 6, "t-pharmacy"),
      p("t-p4", "Thank you, Priya.", 7, "t-pharmacy", "t-priya"),
      p("t-p5", "Please look at me when you speak.", 5),
      p("t-p6", "I'm allergic to penicillin.", 3),
    ],
  },
  {
    id: "aisha",
    name: "Aisha",
    summary: "Had a laryngectomy and types instead of speaking. At work.",
    defaultPlaceId: "a-office",
    defaultPartnerId: "a-marco",
    notes: [
      n("a-me", "about-me", "I'm Aisha. I had a laryngectomy, so I type instead of speaking.", ["Aisha"]),
      n("a-office", "place", "The Northline Design office, third floor, is where I work.", ["Northline Design"]),
      n("a-marco", "person", "Marco is my manager at Northline Design.", ["Marco", "Northline Design"]),
      n("a-jen", "person", "Jen sits next to me at Northline Design and works on the website team.", ["Jen", "Northline Design"]),
      n("a-standup", "routine", "Team stand-up is every weekday at 9:15."),
      n("a-harbor", "routine", "I'm leading the Harbor app redesign, due on Friday.", ["Harbor"]),
      n("a-lunch", "preference", "I usually eat lunch at 12:30 and like the Thai place downstairs."),
    ],
    phrases: [
      p("a-p1", "Morning, Marco.", 9, "a-office", "a-marco"),
      p("a-p2", "The Harbor designs are almost done.", 6, "a-office"),
      p("a-p3", "I'll send it by Friday.", 5, "a-office", "a-marco"),
      p("a-p4", "Can we talk after stand-up?", 4, "a-office"),
      p("a-p5", "Sounds good to me.", 8),
      p("a-p6", "Let me check and get back to you.", 7),
    ],
  },
];
```

- [ ] **Step 3: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add -A
git commit -m "Add Maya, Tom and Aisha example profiles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Conversation state and hooks

**Files:**
- Create: `src/lib/conversation/reducer.ts`, `src/lib/conversation/reducer.test.ts`, `src/lib/conversation/use-suggestions.ts`, `src/lib/conversation/use-suggestions.test.tsx`, `src/lib/conversation/use-stable-targets.ts`, `src/lib/conversation/use-stable-targets.test.tsx`, `src/lib/conversation/use-shortcuts.ts`, `src/lib/conversation/use-shortcuts.test.tsx`

**Interfaces:**
- Consumes: `Turn`, `Reply` (Task 3), `Reaction` (Task 3), `SuggestClient`, `SuggestUnavailableError` (Task 9), `MemoryStore` (Task 5).
- Produces:
  - `reducer.ts`: `type SuggestStatus = "idle" | "thinking" | "ready" | "paused"`, `interface ConversationState { turns; placeId?; partnerId?; typed; replies; heldReplies; reactions; status; speaking; lastSpoken; notice }`, `type ConversationAction` (union below), `initialConversation`, `conversationReducer`, `PAUSED_NOTICE`
  - `use-suggestions.ts`: `useSuggestions(args: { client: SuggestClient | null; memory: MemoryStore | null; state: ConversationState; dispatch: Dispatch<ConversationAction>; isHolding: () => boolean; debounceMs?: number }): void`
  - `use-stable-targets.ts`: `useStableTargets(ref: RefObject<HTMLElement | null>, onRelease: () => void, idleMs?: number): () => boolean`
  - `use-shortcuts.ts`: `useReplyShortcuts(args: { replyCount: number; reactionCount: number; onReply(i: number): void; onReaction(i: number): void; onEscape(): void; enabled?: boolean }): void`

Actions:

```ts
type ConversationAction =
  | { type: "setContext"; placeId?: string; partnerId?: string }
  | { type: "partnerSaid"; id: string; text: string; at: number }
  | { type: "typed"; text: string }
  | { type: "thinking" }
  | { type: "suggestions"; replies: Reply[]; reactions: Reaction[]; done: boolean; hold: boolean }
  | { type: "releaseHeld" }
  | { type: "unavailable" }
  | { type: "speakStart"; id: string; text: string; at: number }
  | { type: "speakEnd"; text: string }
  | { type: "notice"; text: string | null }
  | { type: "reset" };
```

- [ ] **Step 1: Write failing reducer tests**

`src/lib/conversation/reducer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { conversationReducer as r, initialConversation as s0, PAUSED_NOTICE } from "./reducer";
import type { Reply } from "@/lib/types";

const reply = (text: string): Reply => ({ text, noteIds: [], source: "model" });

describe("conversationReducer", () => {
  it("adds partner turns and ignores blank ones", () => {
    const s1 = r(s0, { type: "partnerSaid", id: "1", text: "  What size?  ", at: 1 });
    expect(s1.turns).toEqual([{ id: "1", speaker: "partner", text: "What size?", at: 1 }]);
    expect(r(s1, { type: "partnerSaid", id: "2", text: "   ", at: 2 })).toBe(s1);
  });

  it("shows suggestions and marks them ready", () => {
    const s1 = r(s0, { type: "suggestions", replies: [reply("A")], reactions: [], done: false, hold: false });
    expect(s1.replies).toEqual([reply("A")]);
    expect(s1.status).toBe("ready");
  });

  it("holds new suggestions while the user is aiming, then releases them", () => {
    const s1 = r(s0, { type: "suggestions", replies: [reply("A")], reactions: [], done: true, hold: false });
    const s2 = r(s1, { type: "suggestions", replies: [reply("B")], reactions: [], done: true, hold: true });
    expect(s2.replies).toEqual([reply("A")]);
    expect(s2.heldReplies).toEqual([reply("B")]);
    const s3 = r(s2, { type: "releaseHeld" });
    expect(s3.replies).toEqual([reply("B")]);
    expect(s3.heldReplies).toBeNull();
  });

  it("does not hold when nothing is on screen yet", () => {
    const s1 = r(s0, { type: "suggestions", replies: [reply("A")], reactions: [], done: false, hold: true });
    expect(s1.replies).toEqual([reply("A")]);
  });

  it("pauses when suggestions are unavailable and recovers on the next attempt", () => {
    const s1 = r(s0, { type: "unavailable" });
    expect(s1.status).toBe("paused");
    expect(s1.notice).toBe(PAUSED_NOTICE);
    const s2 = r(s1, { type: "thinking" });
    expect(s2.notice).toBeNull();
    expect(s2.status).toBe("thinking");
  });

  it("records spoken lines and clears matching typed text", () => {
    const s1 = r({ ...s0, typed: "Large please " }, { type: "speakStart", id: "u1", text: "Large please", at: 5 });
    expect(s1.speaking).toBe("Large please");
    expect(s1.lastSpoken).toBe("Large please");
    expect(s1.typed).toBe("");
    expect(s1.turns.at(-1)).toEqual({ id: "u1", speaker: "user", text: "Large please", at: 5 });
    const s2 = r(s1, { type: "speakEnd", text: "Large please" });
    expect(s2.speaking).toBeNull();
    expect(s2.lastSpoken).toBe("Large please");
  });

  it("keeps at most 50 turns", () => {
    let s = s0;
    for (let i = 0; i < 60; i++) s = r(s, { type: "partnerSaid", id: String(i), text: `t${i}`, at: i });
    expect(s.turns).toHaveLength(50);
    expect(s.turns[0].text).toBe("t10");
  });

  it("reset keeps the context", () => {
    const s1 = r(r(s0, { type: "setContext", placeId: "p", partnerId: "q" }), { type: "partnerSaid", id: "1", text: "Hi", at: 1 });
    const s2 = r(s1, { type: "reset" });
    expect(s2.turns).toEqual([]);
    expect(s2.placeId).toBe("p");
  });
});
```

- [ ] **Step 2: Implement the reducer**

`src/lib/conversation/reducer.ts`:

```ts
import type { Reaction } from "@/lib/language-packs/types";
import type { Reply, Turn } from "@/lib/types";

export type SuggestStatus = "idle" | "thinking" | "ready" | "paused";

export interface ConversationState {
  turns: Turn[];
  placeId?: string;
  partnerId?: string;
  typed: string;
  replies: Reply[];
  heldReplies: Reply[] | null;
  reactions: Reaction[];
  status: SuggestStatus;
  speaking: string | null;
  lastSpoken: string | null;
  notice: string | null;
}

export type ConversationAction =
  | { type: "setContext"; placeId?: string; partnerId?: string }
  | { type: "partnerSaid"; id: string; text: string; at: number }
  | { type: "typed"; text: string }
  | { type: "thinking" }
  | { type: "suggestions"; replies: Reply[]; reactions: Reaction[]; done: boolean; hold: boolean }
  | { type: "releaseHeld" }
  | { type: "unavailable" }
  | { type: "speakStart"; id: string; text: string; at: number }
  | { type: "speakEnd"; text: string }
  | { type: "notice"; text: string | null }
  | { type: "reset" };

export const PAUSED_NOTICE = "Suggestions are paused. Typing and speaking still work.";
const MAX_TURNS = 50;

export const initialConversation: ConversationState = {
  turns: [],
  typed: "",
  replies: [],
  heldReplies: null,
  reactions: [],
  status: "idle",
  speaking: null,
  lastSpoken: null,
  notice: null,
};

function addTurn(turns: Turn[], turn: Turn): Turn[] {
  return [...turns, turn].slice(-MAX_TURNS);
}

export function conversationReducer(state: ConversationState, action: ConversationAction): ConversationState {
  switch (action.type) {
    case "setContext":
      return { ...state, placeId: action.placeId, partnerId: action.partnerId };
    case "partnerSaid": {
      const text = action.text.trim();
      if (!text) return state;
      return { ...state, turns: addTurn(state.turns, { id: action.id, speaker: "partner", text, at: action.at }) };
    }
    case "typed":
      return { ...state, typed: action.text };
    case "thinking":
      return {
        ...state,
        status: state.replies.length ? state.status === "paused" ? "ready" : state.status : "thinking",
        notice: state.notice === PAUSED_NOTICE ? null : state.notice,
      };
    case "suggestions": {
      const status = action.replies.length ? "ready" : action.done ? "idle" : state.status;
      if (action.hold && state.replies.length) {
        return { ...state, heldReplies: action.replies, reactions: action.reactions, status };
      }
      return { ...state, replies: action.replies, heldReplies: null, reactions: action.reactions, status };
    }
    case "releaseHeld":
      return state.heldReplies ? { ...state, replies: state.heldReplies, heldReplies: null } : state;
    case "unavailable":
      return { ...state, status: "paused", notice: PAUSED_NOTICE };
    case "speakStart":
      return {
        ...state,
        speaking: action.text,
        lastSpoken: action.text,
        typed: state.typed.trim() === action.text.trim() ? "" : state.typed,
        turns: addTurn(state.turns, { id: action.id, speaker: "user", text: action.text, at: action.at }),
      };
    case "speakEnd":
      return state.speaking === action.text ? { ...state, speaking: null } : state;
    case "notice":
      return { ...state, notice: action.text };
    case "reset":
      return { ...initialConversation, placeId: state.placeId, partnerId: state.partnerId };
  }
}
```

Run: `npx vitest run src/lib/conversation/reducer.test.ts` and expect PASS.

- [ ] **Step 3: Write failing tests for the hooks**

`src/lib/conversation/use-suggestions.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { useReducer } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/lib/memory/store";
import { SuggestUnavailableError, type SuggestClient, type SuggestInput, type SuggestUpdate } from "@/lib/suggest/client";
import { conversationReducer, initialConversation } from "./reducer";
import { useSuggestions } from "./use-suggestions";

function fakeClient(result: SuggestUpdate | Error) {
  const calls: SuggestInput[] = [];
  const client = {
    calls,
    cancel: vi.fn(),
    request: vi.fn(async (input: SuggestInput, onUpdate: (u: SuggestUpdate) => void) => {
      calls.push(input);
      if (result instanceof Error) throw result;
      onUpdate(result);
      return result;
    }),
  };
  return client as unknown as SuggestClient & { calls: SuggestInput[] };
}

const done: SuggestUpdate = { replies: [{ text: "Large, please.", noteIds: [], source: "model" }], reactions: [], done: true };

async function setup(client: SuggestClient) {
  const memory = await MemoryStore.create();
  await memory.replaceAll([], [{ id: "p", text: "My usual, please.", context: { timeOfDay: "morning" }, timesUsed: 3, lastUsed: 1 }]);
  return renderHook(() => {
    const [state, dispatch] = useReducer(conversationReducer, initialConversation);
    useSuggestions({ client, memory, state, dispatch, isHolding: () => false, debounceMs: 300 });
    return { state, dispatch };
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useSuggestions", () => {
  it("asks for replies and reactions right after the partner speaks", async () => {
    const client = fakeClient(done);
    const { result } = await setup(client);
    await act(async () => result.current.dispatch({ type: "partnerSaid", id: "1", text: "What size?", at: 1 }));
    expect(client.calls[0]).toMatchObject({ mode: "replies+reactions", partnerSaid: "What size?" });
    expect(result.current.state.replies[0].text).toBe("Large, please.");
  });

  it("shows phrase matches immediately and asks the model after the debounce", async () => {
    const client = fakeClient(done);
    const { result } = await setup(client);
    await act(async () => result.current.dispatch({ type: "typed", text: "my us" }));
    expect(result.current.state.replies.map((r) => r.source)).toEqual(["phrase"]);
    expect(client.calls).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(client.calls[0]).toMatchObject({ mode: "replies", typed: "my us" });
  });

  it("does not ask the model for a single character", async () => {
    const client = fakeClient(done);
    const { result } = await setup(client);
    await act(async () => result.current.dispatch({ type: "typed", text: "m" }));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(client.calls).toHaveLength(0);
  });

  it("pauses when the service is unavailable", async () => {
    const client = fakeClient(new SuggestUnavailableError("HTTP 503"));
    const { result } = await setup(client);
    await act(async () => result.current.dispatch({ type: "partnerSaid", id: "1", text: "Hi", at: 1 }));
    expect(result.current.state.status).toBe("paused");
  });
});
```

`src/lib/conversation/use-stable-targets.test.tsx`:

```tsx
import { fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStableTargets } from "./use-stable-targets";

let isHolding: () => boolean = () => false;

function Harness({ onRelease }: { onRelease: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  isHolding = useStableTargets(ref, onRelease, 1500);
  return (
    <div ref={ref} data-testid="list">
      <button>Reply</button>
    </div>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useStableTargets", () => {
  it("holds while the pointer moves inside and releases after 1.5 s of stillness", () => {
    const onRelease = vi.fn();
    const { getByTestId } = render(<Harness onRelease={onRelease} />);
    fireEvent.pointerEnter(getByTestId("list"));
    expect(isHolding()).toBe(true);
    vi.advanceTimersByTime(1000);
    fireEvent.pointerMove(getByTestId("list"));
    vi.advanceTimersByTime(1000);
    expect(isHolding()).toBe(true);
    expect(onRelease).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(isHolding()).toBe(false);
    expect(onRelease).toHaveBeenCalled();
  });

  it("releases when the pointer leaves", () => {
    const onRelease = vi.fn();
    const { getByTestId } = render(<Harness onRelease={onRelease} />);
    fireEvent.pointerEnter(getByTestId("list"));
    fireEvent.pointerLeave(getByTestId("list"));
    expect(isHolding()).toBe(false);
    expect(onRelease).toHaveBeenCalled();
  });

  it("holds while a reply has keyboard focus", () => {
    const onRelease = vi.fn();
    const { getByRole } = render(<Harness onRelease={onRelease} />);
    fireEvent.focusIn(getByRole("button"));
    expect(isHolding()).toBe(true);
    fireEvent.focusOut(getByRole("button"), { relatedTarget: document.body });
    expect(isHolding()).toBe(false);
  });
});
```

`src/lib/conversation/use-shortcuts.test.tsx`:

```tsx
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReplyShortcuts } from "./use-shortcuts";

function Harness(props: Parameters<typeof useReplyShortcuts>[0]) {
  useReplyShortcuts(props);
  return <input aria-label="Type a reply" />;
}

describe("useReplyShortcuts", () => {
  const setup = () => {
    const handlers = { onReply: vi.fn(), onReaction: vi.fn(), onEscape: vi.fn() };
    const utils = render(<Harness replyCount={3} reactionCount={2} {...handlers} />);
    return { ...handlers, ...utils };
  };

  it("maps 1 to 3 to replies outside text fields", () => {
    const { onReply } = setup();
    fireEvent.keyDown(document.body, { key: "2" });
    expect(onReply).toHaveBeenCalledWith(1);
    fireEvent.keyDown(document.body, { key: "4" });
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it("ignores digits typed into a text field", () => {
    const { onReply, getByLabelText } = setup();
    fireEvent.keyDown(getByLabelText("Type a reply"), { key: "1" });
    expect(onReply).not.toHaveBeenCalled();
  });

  it("maps Alt+1 and Alt+2 to reactions", () => {
    const { onReaction } = setup();
    fireEvent.keyDown(document.body, { key: "1", code: "Digit1", altKey: true });
    expect(onReaction).toHaveBeenCalledWith(0);
  });

  it("calls onEscape anywhere", () => {
    const { onEscape, getByLabelText } = setup();
    fireEvent.keyDown(getByLabelText("Type a reply"), { key: "Escape" });
    expect(onEscape).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Implement the hooks**

`src/lib/conversation/use-suggestions.ts`:

```ts
import { useCallback, useEffect, useRef, type Dispatch } from "react";
import type { MemoryStore } from "@/lib/memory/store";
import { SuggestUnavailableError, type SuggestClient, type SuggestInput } from "@/lib/suggest/client";
import type { ConversationAction, ConversationState } from "./reducer";

interface Args {
  client: SuggestClient | null;
  memory: MemoryStore | null;
  state: ConversationState;
  dispatch: Dispatch<ConversationAction>;
  isHolding: () => boolean;
  debounceMs?: number;
}

export function useSuggestions({ client, memory, state, dispatch, isHolding, debounceMs = 300 }: Args): void {
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const lastPartner = state.turns.findLast((t) => t.speaker === "partner");
  const partnerTurnId = lastPartner?.id ?? "";

  const run = useCallback(
    async (mode: SuggestInput["mode"], typed: string, partnerSaid: string) => {
      if (!client) return;
      const s = stateRef.current;
      dispatch({ type: "thinking" });
      try {
        await client.request(
          { mode, typed, partnerSaid, context: { now: new Date(), placeId: s.placeId, partnerId: s.partnerId } },
          (u) => dispatch({ type: "suggestions", replies: u.replies, reactions: u.reactions, done: u.done, hold: isHolding() }),
        );
      } catch (err) {
        if (err instanceof SuggestUnavailableError) dispatch({ type: "unavailable" });
        else throw err;
      }
    },
    [client, dispatch, isHolding],
  );

  // The partner finished a turn: ask right away, with reactions.
  useEffect(() => {
    if (!partnerTurnId) return;
    const s = stateRef.current;
    const said = s.turns.findLast((t) => t.speaker === "partner")?.text ?? "";
    void run("replies+reactions", s.typed, said);
  }, [partnerTurnId, run]);

  // Typing: instant matches from the user's phrases, model after a pause.
  const typed = state.typed;
  useEffect(() => {
    const t = typed.trim();
    if (!t || !memory) return;
    const local = memory.matchPhrases(t, 3).map((p) => ({ text: p.text, noteIds: [], source: "phrase" as const }));
    if (local.length) {
      dispatch({ type: "suggestions", replies: local, reactions: stateRef.current.reactions, done: false, hold: isHolding() });
    }
    if (t.length < 2) return;
    const handle = setTimeout(() => {
      const said = stateRef.current.turns.findLast((x) => x.speaker === "partner")?.text ?? "";
      void run("replies", typed, said);
    }, debounceMs);
    return () => clearTimeout(handle);
  }, [typed, memory, run, dispatch, isHolding, debounceMs]);

  // The place or partner changed: refresh if there is something to reply to.
  const contextKey = `${state.placeId ?? ""}|${state.partnerId ?? ""}`;
  const firstContext = useRef(true);
  useEffect(() => {
    if (firstContext.current) {
      firstContext.current = false;
      return;
    }
    const s = stateRef.current;
    const said = s.turns.findLast((t) => t.speaker === "partner")?.text ?? "";
    if (said || s.typed.trim().length >= 2) void run(said ? "replies+reactions" : "replies", s.typed, said);
  }, [contextKey, run]);
}
```

`src/lib/conversation/use-stable-targets.ts`:

```ts
import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * While the pointer is over the list (and moving) or a reply has focus, new
 * suggestions wait, so a reply never changes under someone's finger.
 * Released when the pointer leaves, focus leaves, or after idleMs of stillness.
 */
export function useStableTargets(ref: RefObject<HTMLElement | null>, onRelease: () => void, idleMs = 1500): () => boolean {
  const inside = useRef(false);
  const focused = useRef(false);
  const lastActivity = useRef(0);
  const releaseRef = useRef(onRelease);
  useEffect(() => {
    releaseRef.current = onRelease;
  });

  const isHolding = useCallback(
    () => (inside.current || focused.current) && Date.now() - lastActivity.current < idleMs,
    [idleMs],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      clearTimeout(timer);
      releaseRef.current();
    };
    const activity = () => {
      lastActivity.current = Date.now();
      clearTimeout(timer);
      timer = setTimeout(release, idleMs);
    };
    const onEnter = () => {
      inside.current = true;
      activity();
    };
    const onLeave = () => {
      inside.current = false;
      release();
    };
    const onFocusIn = () => {
      focused.current = true;
      activity();
    };
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
      focused.current = false;
      release();
    };
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointermove", activity);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);
    el.addEventListener("keydown", activity);
    return () => {
      clearTimeout(timer);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointermove", activity);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
      el.removeEventListener("keydown", activity);
    };
  }, [ref, idleMs]);

  return isHolding;
}
```

`src/lib/conversation/use-shortcuts.ts`:

```ts
import { useEffect, useRef } from "react";

interface Args {
  replyCount: number;
  reactionCount: number;
  onReply: (index: number) => void;
  onReaction: (index: number) => void;
  onEscape: () => void;
  enabled?: boolean;
}

function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function useReplyShortcuts(args: Args): void {
  const ref = useRef(args);
  useEffect(() => {
    ref.current = args;
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const a = ref.current;
      if (a.enabled === false) return;
      if (e.key === "Escape") {
        a.onEscape();
        return;
      }
      if (inTextField(e.target) || e.ctrlKey || e.metaKey) return;
      // With Alt, some layouts change e.key; e.code stays "Digit1".
      const digit = /^Digit([1-9])$/.exec(e.code)?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : null);
      if (!digit) return;
      const index = Number(digit) - 1;
      if (e.altKey) {
        if (index < a.reactionCount) {
          e.preventDefault();
          a.onReaction(index);
        }
      } else if (index < a.replyCount) {
        e.preventDefault();
        a.onReply(index);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/conversation`
Expected: PASS. `Array.prototype.findLast` needs `"lib": ["es2023", ...]` in `tsconfig.json`; if TypeScript complains, change `"lib"` to `["dom", "dom.iterable", "es2023"]`.

- [ ] **Step 6: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add -A
git commit -m "Add conversation state, suggestion timing, stable targets and shortcuts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Conversation screen

**Files:**
- Create: `src/components/announcer.tsx`, `src/components/cue-light.tsx`, `src/components/reply-list.tsx`, `src/components/reaction-bar.tsx`, `src/components/composer.tsx`, `src/components/caption-log.tsx`, `src/components/partner-input.tsx`, `src/components/context-bar.tsx`, `src/components/spoken-caption.tsx`, `src/components/voice-status.tsx`, `src/components/profile-picker.tsx`, `src/components/conversation-screen.tsx`, `src/components/components.test.tsx`
- Replace: `src/app/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 3 to 12.
- Produces: `ConversationScreen` (default route). Visible text and roles the e2e test in Task 14 relies on:
  - heading "Replies"; cue status text "Replies ready" when replies are on screen
  - text field labelled "What they said" with button "Add"
  - text field labelled "Type a reply" with button "Speak"
  - reply buttons whose accessible name is the reply text (or "Stop saying: <text>" while speaking)
  - selects labelled "Place" and "Talking with"
  - profile buttons named "Maya", "Tom", "Aisha" in a section headed "Try it with an example profile"
  - region labelled "What you said" showing the last spoken line
  - button "Example profiles" in the header

Design rules for this task (spec 6.2 to 6.4): the cue light is the only decorative element; reply buttons are full width, min 64 px, `text-reply font-semibold`, surface background, 2 px `border-ink/15` border, `rounded-control`, with the shortcut number in a round chip marked `aria-hidden`; partner lines have a 4 px left border in `partner` and a "Sam" (or "Them") label; user lines have a `surface` background and a "You" label; no cards with shadows; no all-caps labels; no em dashes.

- [ ] **Step 1: Write failing component tests**

`src/components/components.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./composer";
import { CueLight } from "./cue-light";
import { ReplyList } from "./reply-list";
import { CaptionLog } from "./caption-log";
import type { Reply } from "@/lib/types";

const replies: Reply[] = [
  { text: "Large, please.", noteIds: [], source: "model" },
  { text: "My usual, please.", noteIds: [], source: "phrase" },
];

describe("ReplyList", () => {
  it("renders replies as buttons named by their text and speaks on click", async () => {
    const onSpeak = vi.fn();
    render(<ReplyList replies={replies} speaking={null} status="ready" onSpeak={onSpeak} onStop={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Large, please." }));
    expect(onSpeak).toHaveBeenCalledWith("Large, please.");
    expect(screen.getByText("From your phrases")).toBeInTheDocument();
  });

  it("turns the speaking reply into a stop button", async () => {
    const onStop = vi.fn();
    render(<ReplyList replies={replies} speaking="Large, please." status="ready" onSpeak={vi.fn()} onStop={onStop} />);
    await userEvent.click(screen.getByRole("button", { name: "Stop saying: Large, please." }));
    expect(onStop).toHaveBeenCalled();
  });

  it("explains the empty state", () => {
    render(<ReplyList replies={[]} speaking={null} status="idle" onSpeak={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByText("Replies will appear here when someone talks to you or you start typing.")).toBeInTheDocument();
  });
});

describe("CueLight", () => {
  it("says what is happening in text", () => {
    const { rerender } = render(<CueLight status="ready" />);
    expect(screen.getByText("Replies ready")).toBeInTheDocument();
    rerender(<CueLight status="thinking" />);
    expect(screen.getByText("Finding replies…")).toBeInTheDocument();
    rerender(<CueLight status="paused" />);
    expect(screen.getByText("Suggestions paused")).toBeInTheDocument();
  });
});

describe("Composer", () => {
  it("speaks on Enter and on the Speak button", async () => {
    const onSpeak = vi.fn();
    render(<Composer value="hello" onChange={vi.fn()} onSpeak={onSpeak} onFocusReplies={vi.fn()} onEscape={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Type a reply"), "{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Speak" }));
    expect(onSpeak).toHaveBeenCalledTimes(2);
  });

  it("moves to the replies with the up arrow", async () => {
    const onFocusReplies = vi.fn();
    render(<Composer value="" onChange={vi.fn()} onSpeak={vi.fn()} onFocusReplies={onFocusReplies} onEscape={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Type a reply"), "{ArrowUp}");
    expect(onFocusReplies).toHaveBeenCalled();
  });
});

describe("CaptionLog", () => {
  it("labels who said each line", () => {
    render(
      <CaptionLog
        partnerName="Sam"
        turns={[
          { id: "1", speaker: "partner", text: "What size?", at: 1 },
          { id: "2", speaker: "user", text: "Large, please.", at: 2 },
        ]}
      />,
    );
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("What size?")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to see failure**

Run: `npx vitest run src/components/components.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the small components**

`src/components/announcer.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const AnnounceContext = createContext<(message: string) => void>(() => {});

/** Polite live region, at most one announcement per second. */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const announce = useCallback((next: string) => {
    clearTimeout(timer.current);
    const wait = Math.max(0, 1000 - (Date.now() - last.current));
    timer.current = setTimeout(() => {
      last.current = Date.now();
      setMessage("");
      timer.current = setTimeout(() => setMessage(next), 50);
    }, wait);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div role="status" aria-live="polite" className="sr-only">
        {message}
      </div>
    </AnnounceContext.Provider>
  );
}

export function useAnnounce(): (message: string) => void {
  return useContext(AnnounceContext);
}
```

`src/components/cue-light.tsx`:

```tsx
import type { SuggestStatus } from "@/lib/conversation/reducer";

const LABELS: Record<SuggestStatus, string> = {
  idle: "Waiting",
  thinking: "Finding replies…",
  ready: "Replies ready",
  paused: "Suggestions paused",
};

/** The cue light: lit amber with an ink border when replies are ready. */
export function CueLight({ status }: { status: SuggestStatus }) {
  const on = status === "ready";
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`inline-block size-7 rounded-full border-2 transition-[background-color,border-color] duration-150 ${
          on ? "border-ink bg-cue" : "border-muted bg-transparent"
        }`}
      />
      <span className={`text-label ${on ? "font-bold text-ink" : "text-muted"}`}>{LABELS[status]}</span>
    </span>
  );
}
```

`src/components/reply-list.tsx`:

```tsx
"use client";

import { Stop } from "@phosphor-icons/react";
import { forwardRef } from "react";
import type { SuggestStatus } from "@/lib/conversation/reducer";
import type { Reply } from "@/lib/types";
import { CueLight } from "./cue-light";

interface Props {
  replies: Reply[];
  speaking: string | null;
  status: SuggestStatus;
  onSpeak: (text: string) => void;
  onStop: () => void;
}

export const ReplyList = forwardRef<HTMLDivElement, Props>(function ReplyList({ replies, speaking, status, onSpeak, onStop }, ref) {
  return (
    <div ref={ref} id="replies" tabIndex={-1} aria-labelledby="replies-heading" className="flex flex-col gap-3 outline-none">
      <div className="flex items-center justify-between gap-4">
        <h2 id="replies-heading" className="text-body font-bold">
          Replies
        </h2>
        <CueLight status={status} />
      </div>
      {replies.length === 0 ? (
        <p className="text-body text-muted">Replies will appear here when someone talks to you or you start typing.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {replies.map((reply, i) => {
            const isSpeaking = speaking === reply.text;
            return (
              <li key={`${i}-${reply.text}`}>
                <button
                  type="button"
                  aria-keyshortcuts={String(i + 1)}
                  aria-label={isSpeaking ? `Stop saying: ${reply.text}` : undefined}
                  onClick={() => (isSpeaking ? onStop() : onSpeak(reply.text))}
                  className={`flex min-h-16 w-full items-center gap-4 rounded-control border-2 px-4 py-3 text-left transition-[border-color,background-color,transform] duration-150 active:translate-y-px ${
                    isSpeaking ? "border-ink bg-cue text-on-cue" : "border-ink/15 bg-surface text-ink hover:border-ink/50"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`grid size-9 shrink-0 place-items-center rounded-full border-2 text-label font-bold ${
                      isSpeaking ? "border-on-cue" : "border-ink/30 text-muted"
                    }`}
                  >
                    {isSpeaking ? <Stop weight="fill" size={16} /> : i + 1}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-reply font-semibold break-words">{reply.text}</span>
                    {reply.source === "phrase" && !isSpeaking && <span className="text-label text-muted">From your phrases</span>}
                    {isSpeaking && <span className="text-label font-bold">Speaking. Tap to stop.</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
});
```

`src/components/reaction-bar.tsx`:

```tsx
import type { Reaction } from "@/lib/language-packs/types";

export function ReactionBar({ reactions, onReact }: { reactions: Reaction[]; onReact: (text: string) => void }) {
  if (reactions.length === 0) return null;
  return (
    <div role="group" aria-labelledby="reactions-label" className="flex flex-wrap items-center gap-3">
      <span id="reactions-label" className="text-label text-muted">
        Quick reactions
      </span>
      {reactions.map((r, i) => (
        <button
          key={r.id}
          type="button"
          aria-keyshortcuts={`Alt+${i + 1}`}
          onClick={() => onReact(r.text)}
          className="min-h-12 rounded-full border-2 border-ink/15 bg-surface px-5 text-body font-semibold transition-[border-color] duration-150 hover:border-ink/50 active:translate-y-px"
        >
          {r.text}
        </button>
      ))}
    </div>
  );
}
```

`src/components/composer.tsx`:

```tsx
"use client";

import { SpeakerHigh } from "@phosphor-icons/react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSpeak: (text: string) => void;
  onFocusReplies: () => void;
  onEscape: () => void;
}

export function Composer({ value, onChange, onSpeak, onFocusReplies, onEscape }: Props) {
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSpeak(value);
      }}
    >
      <label htmlFor="composer" className="text-label text-muted">
        Type a reply
      </label>
      <div className="flex gap-3">
        <input
          id="composer"
          name="reply"
          type="text"
          autoComplete="off"
          enterKeyHint="send"
          placeholder="Type or pick a reply…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              onFocusReplies();
            } else if (e.key === "Escape") {
              onEscape();
            }
          }}
          className="min-h-14 min-w-0 flex-1 rounded-control border-2 border-ink/30 bg-surface px-4 text-body text-ink placeholder:text-muted"
        />
        <button
          type="submit"
          className="flex min-h-14 items-center gap-2 rounded-control border-2 border-ink bg-ink px-5 text-body font-bold text-ground transition-[transform] duration-150 active:translate-y-px"
        >
          <SpeakerHigh aria-hidden="true" size={22} weight="bold" />
          Speak
        </button>
      </div>
    </form>
  );
}
```

`src/components/caption-log.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import type { Turn } from "@/lib/types";

export function CaptionLog({ turns, partnerName }: { turns: Turn[]; partnerName: string }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns.length]);

  return (
    <section aria-labelledby="conversation-heading" className="flex min-h-0 flex-col gap-3">
      <h2 id="conversation-heading" className="text-body font-bold">
        Conversation
      </h2>
      {turns.length === 0 ? (
        <p className="text-body text-muted">What the other person says will appear here in large text.</p>
      ) : (
        <ol className="flex max-h-[45dvh] flex-col gap-4 overflow-y-auto pr-1 lg:max-h-[70dvh]">
          {turns.map((t) =>
            t.speaker === "partner" ? (
              <li key={t.id} className="border-l-4 border-partner pl-4">
                <span className="block text-label font-bold text-partner">{partnerName}</span>
                <span className="block text-caption font-medium break-words">{t.text}</span>
              </li>
            ) : (
              <li key={t.id} className="rounded-control bg-surface px-4 py-3 lg:ml-12">
                <span className="block text-label font-bold text-muted">You</span>
                <span className="block text-reply break-words">{t.text}</span>
              </li>
            ),
          )}
          <li ref={end} aria-hidden="true" />
        </ol>
      )}
    </section>
  );
}
```

`src/components/partner-input.tsx`:

```tsx
"use client";

import { useState } from "react";

export function PartnerInput({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        onSubmit(value);
        setValue("");
      }}
    >
      <label htmlFor="partner-input" className="text-label text-muted">
        What they said
      </label>
      <div className="flex gap-3">
        <input
          id="partner-input"
          name="partner"
          type="text"
          autoComplete="off"
          placeholder="Type what the other person said…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-h-14 min-w-0 flex-1 rounded-control border-2 border-ink/30 bg-surface px-4 text-body text-ink placeholder:text-muted"
        />
        <button
          type="submit"
          className="min-h-14 rounded-control border-2 border-ink/40 bg-surface px-5 text-body font-bold transition-[border-color] duration-150 hover:border-ink"
        >
          Add
        </button>
      </div>
    </form>
  );
}
```

`src/components/context-bar.tsx`:

```tsx
import type { Note } from "@/lib/types";

interface Props {
  places: Note[];
  people: Note[];
  placeId?: string;
  partnerId?: string;
  onChange: (placeId?: string, partnerId?: string) => void;
}

const nameOf = (n: Note) => n.entities[0] ?? n.text;
const selectClass =
  "min-h-12 w-full rounded-control border-2 border-ink/30 bg-surface px-3 text-body text-ink";

export function ContextBar({ places, people, placeId, partnerId, onChange }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-label text-muted">
        Place
        <select className={selectClass} value={placeId ?? ""} onChange={(e) => onChange(e.target.value || undefined, partnerId)}>
          <option value="">Not set</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {nameOf(p)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-label text-muted">
        Talking with
        <select className={selectClass} value={partnerId ?? ""} onChange={(e) => onChange(placeId, e.target.value || undefined)}>
          <option value="">Someone new</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {nameOf(p)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
```

`src/components/spoken-caption.tsx`:

```tsx
import { SpeakerHigh } from "@phosphor-icons/react/dist/ssr";

export function SpokenCaption({ speaking, lastSpoken }: { speaking: string | null; lastSpoken: string | null }) {
  if (!lastSpoken) return null;
  return (
    <section aria-label="What you said" className="rounded-control border-2 border-ink/15 px-4 py-3">
      <p className="flex items-center gap-2 text-label font-bold text-muted">
        <SpeakerHigh aria-hidden="true" size={18} weight="bold" />
        {speaking ? "Speaking" : "Last said"}
      </p>
      <p className="text-caption font-semibold break-words">{speaking ?? lastSpoken}</p>
    </section>
  );
}
```

`src/components/voice-status.tsx`:

```tsx
import type { VoiceMode } from "@/lib/voice/engine";

export function VoiceStatus({ mode, progress }: { mode: VoiceMode; progress: number }) {
  const text =
    mode === "loading"
      ? `Getting the natural voice ready… ${Math.max(0, Math.min(100, progress))}%. The basic voice works in the meantime.`
      : mode === "basic"
        ? "Using the basic voice."
        : "Natural voice ready.";
  return <p className="text-label text-muted">{text}</p>;
}
```

`src/components/profile-picker.tsx`:

```tsx
import type { Persona } from "@/data/personas";

export function ProfilePicker({ personas, onChoose, onSkip }: { personas: Persona[]; onChoose: (p: Persona) => void; onSkip: () => void }) {
  return (
    <section aria-labelledby="profiles-heading" className="flex max-w-3xl flex-col gap-4">
      <h2 id="profiles-heading" className="text-caption font-bold text-balance">
        Try it with an example profile
      </h2>
      <p className="max-w-[60ch] text-body text-muted">
        Each profile has notes about a person&apos;s life, so the replies can be personal. Notes stay in this browser.
      </p>
      <ul className="flex flex-col gap-3">
        {personas.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onChoose(p)}
              className="flex min-h-16 w-full flex-col items-start gap-1 rounded-control border-2 border-ink/15 bg-surface px-4 py-3 text-left transition-[border-color] duration-150 hover:border-ink/50 active:translate-y-px"
            >
              <span className="text-reply font-bold">{p.name}</span>
              <span className="text-body text-muted">{p.summary}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onSkip} className="min-h-12 self-start text-body font-bold underline underline-offset-4">
        Continue without a profile
      </button>
    </section>
  );
}
```

- [ ] **Step 4: Run the component tests**

Run: `npx vitest run src/components/components.test.tsx`
Expected: PASS.

- [ ] **Step 5: Implement the screen and page**

`src/components/conversation-screen.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { personas, type Persona } from "@/data/personas";
import { conversationReducer, initialConversation } from "@/lib/conversation/reducer";
import { useReplyShortcuts } from "@/lib/conversation/use-shortcuts";
import { useStableTargets } from "@/lib/conversation/use-stable-targets";
import { useSuggestions } from "@/lib/conversation/use-suggestions";
import { en } from "@/lib/language-packs/en";
import { getBrowserMemory } from "@/lib/memory/browser";
import type { MemoryStore } from "@/lib/memory/store";
import { SuggestClient } from "@/lib/suggest/client";
import { getBrowserVoice } from "@/lib/voice/browser";
import type { VoiceEngine, VoiceMode } from "@/lib/voice/engine";
import { AnnouncerProvider, useAnnounce } from "./announcer";
import { CaptionLog } from "./caption-log";
import { Composer } from "./composer";
import { ContextBar } from "./context-bar";
import { PartnerInput } from "./partner-input";
import { ProfilePicker } from "./profile-picker";
import { ReactionBar } from "./reaction-bar";
import { ReplyList } from "./reply-list";
import { SpokenCaption } from "./spoken-caption";
import { VoiceStatus } from "./voice-status";

export function ConversationScreen() {
  return (
    <AnnouncerProvider>
      <Screen />
    </AnnouncerProvider>
  );
}

function Screen() {
  const announce = useAnnounce();
  const [memory, setMemory] = useState<MemoryStore | null>(null);
  const [notesVersion, setNotesVersion] = useState(0);
  const [showProfiles, setShowProfiles] = useState(false);
  const [voice, setVoice] = useState<VoiceEngine | null>(null);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("loading");
  const [voiceProgress, setVoiceProgress] = useState(0);
  const [state, dispatch] = useReducer(conversationReducer, initialConversation);

  useEffect(() => {
    let cancelled = false;
    void getBrowserMemory().then((m) => {
      if (cancelled) return;
      setMemory(m);
      if (!m.isDurable) dispatch({ type: "notice", text: "Notes won't be saved in this window." });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const v = getBrowserVoice();
    setVoice(v);
    setVoiceMode(v.mode);
    const offs = [
      v.on("mode", setVoiceMode),
      v.on("progress", setVoiceProgress),
      v.on("start", (text) => {
        dispatch({ type: "speakStart", id: crypto.randomUUID(), text, at: Date.now() });
        navigator.vibrate?.(40);
      }),
      v.on("end", (text) => dispatch({ type: "speakEnd", text })),
    ];
    v.load();
    return () => offs.forEach((off) => off());
  }, []);

  const client = useMemo(() => (memory ? new SuggestClient({ memory, pack: en }) : null), [memory]);

  const replyListRef = useRef<HTMLDivElement>(null);
  const releaseHeld = useCallback(() => dispatch({ type: "releaseHeld" }), []);
  const isHolding = useStableTargets(replyListRef, releaseHeld);
  useSuggestions({ client, memory, state, dispatch, isHolding });

  useEffect(() => {
    if (!voice) return;
    for (const r of state.replies) voice.prepare(r.text);
  }, [voice, state.replies]);

  useEffect(() => {
    if (state.status === "ready") announce("Replies ready");
  }, [state.status, announce]);

  const speak = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || !voice) return;
      void voice.speak(t);
      void memory?.addPhrase(t, { now: new Date(), placeId: state.placeId, partnerId: state.partnerId });
    },
    [voice, memory, state.placeId, state.partnerId],
  );
  const stop = useCallback(() => voice?.stop(), [voice]);

  const focusReplies = useCallback(() => {
    replyListRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  useReplyShortcuts({
    replyCount: state.replies.length,
    reactionCount: state.reactions.length,
    onReply: (i) => speak(state.replies[i]?.text ?? ""),
    onReaction: (i) => speak(state.reactions[i]?.text ?? ""),
    onEscape: () => {
      if (state.speaking) stop();
      else dispatch({ type: "typed", text: "" });
    },
  });

  const choosePersona = useCallback(
    async (p: Persona) => {
      if (!memory) return;
      await memory.replaceAll(p.notes, p.phrases);
      dispatch({ type: "reset" });
      dispatch({ type: "setContext", placeId: p.defaultPlaceId, partnerId: p.defaultPartnerId });
      setNotesVersion((v) => v + 1);
      setShowProfiles(false);
    },
    [memory],
  );

  const [skippedProfiles, setSkippedProfiles] = useState(false);
  const notes = useMemo(() => (memory ? memory.notes() : []), [memory, notesVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const places = notes.filter((n) => n.kind === "place");
  const people = notes.filter((n) => n.kind === "person");
  const partnerName = (state.partnerId && memory?.getNote(state.partnerId)?.entities[0]) || "Them";
  const needsProfile = memory !== null && (showProfiles || (notes.length === 0 && !skippedProfiles));

  return (
    <>
      <header className="mx-auto flex w-full max-w-[90rem] items-center justify-between gap-4 px-4 py-4 lg:px-8">
        <p className="text-2xl font-extrabold tracking-tight" translate="no">
          OnBeat
        </p>
        <button
          type="button"
          onClick={() => setShowProfiles((s) => !s)}
          aria-expanded={needsProfile}
          className="min-h-12 rounded-control border-2 border-ink/30 px-4 text-body font-bold transition-[border-color] duration-150 hover:border-ink"
        >
          Example profiles
        </button>
      </header>
      <main id="main" className="mx-auto w-full max-w-[90rem] px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] lg:px-8">
        <h1 className="sr-only">Conversation</h1>
        {state.notice && (
          <p role="status" className="mb-4 rounded-control border-2 border-ink/30 px-4 py-3 text-body">
            {state.notice}
          </p>
        )}
        {needsProfile ? (
          <ProfilePicker
            personas={personas}
            onChoose={(p) => void choosePersona(p)}
            onSkip={() => {
              setSkippedProfiles(true);
              setShowProfiles(false);
            }}
          />
        ) : (
          <div className="conv-grid">
            <div className="[grid-area:context]">
              <ContextBar
                places={places}
                people={people}
                placeId={state.placeId}
                partnerId={state.partnerId}
                onChange={(placeId, partnerId) => dispatch({ type: "setContext", placeId, partnerId })}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-6 [grid-area:log]">
              <CaptionLog turns={state.turns} partnerName={partnerName} />
              <PartnerInput onSubmit={(text) => dispatch({ type: "partnerSaid", id: crypto.randomUUID(), text, at: Date.now() })} />
            </div>
            <div className="flex min-w-0 flex-col gap-6 [grid-area:side]">
              <SpokenCaption speaking={state.speaking} lastSpoken={state.lastSpoken} />
              <ReactionBar reactions={state.reactions} onReact={speak} />
              <ReplyList ref={replyListRef} replies={state.replies} speaking={state.speaking} status={state.status} onSpeak={speak} onStop={stop} />
              <Composer
                value={state.typed}
                onChange={(text) => dispatch({ type: "typed", text })}
                onSpeak={speak}
                onFocusReplies={focusReplies}
                onEscape={() => (state.speaking ? stop() : dispatch({ type: "typed", text: "" }))}
              />
              <VoiceStatus mode={voiceMode} progress={voiceProgress} />
            </div>
          </div>
        )}
      </main>
    </>
  );
}
```

Note: the reply list must stay mounted whenever the conversation view is shown (it is), because `useStableTargets` attaches listeners once on mount. If lint rejects the `eslint-disable-line` comment, replace the memo with a `useState` of notes updated wherever `notesVersion` changes.

`src/app/page.tsx`:

```tsx
import { ConversationScreen } from "@/components/conversation-screen";

export default function Home() {
  return <ConversationScreen />;
}
```

- [ ] **Step 6: Manual check in the browser**

Run `npm run dev`, open http://localhost:3000, choose Maya, type "What size would you like?" in "What they said", press Add. Without API keys the screen shows "Suggestions are paused. Typing and speaking still work." Typing "my us" in "Type a reply" shows "My usual, please." from phrases instantly. Pressing Speak says it (basic voice until Kokoro loads) and it appears under "Last said". With keys in `.env.local`, three replies appear and the cue light turns amber. Check both light and dark (system setting), a 320 px wide window and 200% browser zoom for overflow.

- [ ] **Step 7: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run build`

```bash
git add -A
git commit -m "Build the conversation screen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: End-to-end and accessibility tests

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/conversation.spec.ts`
- Modify: `.github/workflows/ci.yml`, `README.md` (add a "Run it locally" section)

**Interfaces:**
- Consumes: the UI contract listed in Task 13.

- [ ] **Step 1: Playwright config**

`playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm run start -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
```

Install the browser once: `npx playwright install chromium`.

- [ ] **Step 2: Write the tests**

`tests/e2e/conversation.spec.ts`:

```ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const MODEL_LINES = [
  '{"reply": "Large, please.", "notes": []}',
  '{"reply": "Hi Sam, my usual please.", "notes": ["m-sam"]}',
  '{"reply": "What sizes do you have?", "notes": []}',
  '{"reactions": ["mm-hmm", "thanks"]}',
].join("\n");

async function prepare(page: Page, theme?: string) {
  // No model downloads in tests: the embedder falls back to text search and
  // the voice falls back to the (stubbed) browser speech engine.
  await page.route(/huggingface\.co|hf\.co|cdn-lfs/, (route) => route.abort());
  await page.route("**/api/suggest", (route) =>
    route.fulfill({ status: 200, contentType: "text/plain", headers: { "x-onbeat-provider": "groq" }, body: MODEL_LINES }),
  );
  await page.addInitScript((themeName) => {
    if (themeName) localStorage.setItem("onbeat:theme", themeName);
    const spoken: string[] = [];
    (window as unknown as { __spoken: string[] }).__spoken = spoken;
    const synth = {
      speaking: false,
      pending: false,
      paused: false,
      getVoices: () => [],
      cancel() {},
      pause() {},
      resume() {},
      addEventListener() {},
      removeEventListener() {},
      speak(u: SpeechSynthesisUtterance) {
        spoken.push(u.text);
        setTimeout(() => u.onend?.(new Event("end") as SpeechSynthesisEvent), 30);
      },
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  }, theme);
}

async function startWithMaya(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Maya/ }).click();
  await expect(page.getByLabel("Place")).toHaveValue("m-cafe");
}

test("a partner line produces checked replies that can be spoken", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await page.getByLabel("What they said").fill("What size would you like?");
  await page.getByRole("button", { name: "Add" }).click();

  await expect(page.getByText("Replies ready")).toBeVisible();
  await expect(page.getByRole("button", { name: "Large, please." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hi Sam, my usual please." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mm-hmm" })).toBeVisible();

  await page.locator("body").click();
  await page.keyboard.press("1");
  await expect(page.getByRole("region", { name: "What you said" })).toContainText("Large, please.");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)).toContain("Large, please.");
});

test("typing shows matching past phrases immediately", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await page.getByLabel("Type a reply").fill("my us");
  await expect(page.getByRole("button", { name: /My usual, please\./ })).toBeVisible();
});

test("the skip link moves focus to the replies", async ({ page }) => {
  await prepare(page);
  await startWithMaya(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to replies" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#replies")).toBeFocused();
});

for (const theme of [undefined, "dark", "contrast"]) {
  test(`no accessibility violations (${theme ?? "light"})`, async ({ page }) => {
    await prepare(page, theme);
    await page.goto("/");
    const picker = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(picker.violations).toEqual([]);

    await page.getByRole("button", { name: /^Maya/ }).click();
    await page.getByLabel("What they said").fill("What size would you like?");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Replies ready")).toBeVisible();
    const conversation = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(conversation.violations).toEqual([]);
  });
}

test("no horizontal scrolling at 320 px", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await startWithMaya(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("reduced motion makes transitions instant", async ({ page }) => {
  await prepare(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startWithMaya(page);
  const duration = await page.getByRole("button", { name: "Example profiles" }).evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
});
```

- [ ] **Step 3: Run the tests**

Run: `npx playwright install chromium && npm run e2e`
Expected: all pass. Fix any axe violation in the component that causes it (do not disable rules). Colour-contrast violations mean a token or class is wrong; check against Task 2's measured values.

- [ ] **Step 4: Add e2e to CI**

Append to the `check` job in `.github/workflows/ci.yml` after the build step:

```yaml
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
```

- [ ] **Step 5: Document local setup**

Add to `README.md` before the "License" section:

```markdown
## Run it locally

You need Node 24.

1. `npm install`
2. Copy `.env.example` to `.env.local` and add free API keys from [Groq](https://console.groq.com/keys) and [Cerebras](https://cloud.cerebras.ai). The app still runs without them, but only past phrases are suggested.
3. `npm run dev` and open http://localhost:3000

The first visit downloads the voice (about 90 MB) and the search model (about 23 MB). Both are cached by the browser afterwards.

Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run e2e`.
```

Also change the README "Status" section to: "Core conversation works with typed input. Listening through the microphone is next." Keep the README's plain style: no emoji, no em dashes.

- [ ] **Step 6: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run e2e`

```bash
git add -A
git commit -m "Add end-to-end and accessibility tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Push the branch**

```bash
git pull --rebase origin main
git push -u origin feat/core
```

---

## After this plan

- **Plan 2 (listening):** hearing worker (Silero VAD + Moonshine), live captions, speculative requests during partner speech (every 2.5 s after 3 new words), turn-end requests, response-gap timing, provider quota guard, eval runner with the three personas (hit rate, invented-detail rate, keystrokes saved, latency) and the model choice.
- **Plan 3 (finish):** notes and settings screens (voice with written descriptions, speed, caption size, simple language, reaction list, theme, vibration, hold to speak, shortcut list), first-run flow, full accessibility pass with colour-vision screenshots, deploy to Vercel (team `hujaifa-muaz`), README results table, 120-second demo video.
