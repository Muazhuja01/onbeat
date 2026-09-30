# OnBeat voice choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each profile picks how its voice sounds (female or male, American or British, a style, a speed) during setup, hears a sample first, and can change it any time from the profile menu or Settings.

**Architecture:** A pure table maps a `VoiceChoice` to a Kokoro voice id and speed. The choice is stored on the profile record in the registry and carried in export files. The browser voice engine reads a module-level "current voice" that the conversation screen sets whenever a profile or demo opens or the choice changes; the engine's clip cache is already keyed by voice and speed. One `VoicePicker` component serves setup and the change screen.

**Tech Stack:** Next.js 16, React 19, TypeScript, zod, vitest + Testing Library, Playwright + axe, kokoro-js (in a worker).

**Spec:** `docs/superpowers/specs/2026-09-30-onbeat-voice-design.md`

## Global Constraints

- Voices offered, exactly: Female American Warm `af_heart`, Bright `af_bella`, Soft `af_nicole`; Female British Warm `bf_emma`, Clear `bf_isabella`; Male American Calm `am_michael`, Deep `am_fenrir`, Lively `am_puck`; Male British Calm `bm_george`, Warm `bm_fable`.
- Speeds: Slower 0.85, Normal 1, Faster 1.15.
- Default: Female, American, Warm, Normal (`af_heart`, 1). A profile without a stored choice uses it.
- Demos: Maya and Aisha the default; Tom Male, American, Calm, Normal.
- Setup is 4 steps; the voice step is step 3 of 4, heading "How should your voice sound?". Skip keeps the default.
- Sample text: "Hi, I'm <name>. This is how I'll sound."
- Male note, shown when Male is chosen: "Male voices sound a little less natural than female ones for now."
- While the natural voice is loading, the sample button is disabled and reads "Voice loading, <n>%". In basic mode a hint says "Your device's voice will be used, and it may not match this choice."
- Summary format: "Male, American, calm" (gender, accent, style lower-case).
- Profile menu item: "Voice: <summary>". Settings row: label "Voice", the summary, a "Change" button; in basic mode it adds "Using your device's voice".
- Per profile; switching profile switches voice. Not offered in demo menus.
- UI copy plain, addressed to the user, no emoji. Radio groups use `fieldset` and `legend` like the Theme setting. Targets at least 48 px tall (`min-h-12`).

## Review Focus

1. **Switching profile or opening a demo**: the next spoken line must use that profile's voice, never the previous one's. Test in Task 6 (e2e: switch, speak, check the recorded rate/voice).
2. **Changing voice with replies already prepared**: the next reply is spoken in the new voice. The cache key already includes voice and speed; Task 3 adds a test that pins it.
3. **An imported file with a bad or unknown voice** (hand-edited, or from a newer version with more voices): import still succeeds with the default voice. Test in Task 2.
4. **Pressing Play in the picker while a reply is speaking, or pressing it twice**: the old speech stops and the sample plays once; the saved choice does not change. Test in Task 3 (engine) and Task 4 (picker).
5. **Changing gender or accent when the chosen style doesn't exist for the new pair** (e.g. Soft, then British): the style falls back to the first one for that pair, never an invalid combination. Test in Task 1 (`normalizeChoice`) and Task 4.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/voice/choices.ts` (new) | Voice table, `VoiceChoice`, defaults, mapping, labels, validation |
| `src/lib/profiles/registry.ts` | `ProfileInfo.voice`, `create(name, voice?)`, `setVoice` |
| `src/lib/profiles/transfer.ts` | `profile.voice` in export files |
| `src/data/personas.ts` | `Persona.voice` |
| `src/lib/voice/engine.ts` | `speak(text, as?)` for samples |
| `src/lib/voice/browser.ts` | Current voice (`setCurrentVoice`) instead of the old localStorage key |
| `src/components/voice-picker.tsx` (new) | `VoicePicker` and `VoiceScreen` |
| `src/components/profile-setup.tsx` | Step 3 of 4 |
| `src/components/profile-menu.tsx`, `src/components/settings-panel.tsx` | Entries to change the voice |
| `src/components/conversation-screen.tsx` | Sets the current voice; `voice` view; passes voice props |
| `tests/e2e/helpers.ts`, `tests/e2e/voice.spec.ts` (new) | Record utterance rate; end to end |

---

### Task 1: Voice table

**Files:**
- Create: `src/lib/voice/choices.ts`
- Test: `src/lib/voice/choices.test.ts`

**Interfaces:**
- Produces:

```ts
export type Gender = "female" | "male";
export type Accent = "american" | "british";
export type Speed = "slower" | "normal" | "faster";
export interface VoiceChoice { gender: Gender; accent: Accent; style: string; speed: Speed }
export const DEFAULT_VOICE: VoiceChoice; // female, american, warm, normal
export const GENDERS: { value: Gender; label: string }[];   // Female, Male
export const ACCENTS: { value: Accent; label: string }[];   // American, British
export const SPEEDS: { value: Speed; label: string; rate: number }[]; // Slower 0.85, Normal 1, Faster 1.15
export function stylesFor(gender: Gender, accent: Accent): { value: string; label: string; id: string }[];
export function normalizeChoice(c: VoiceChoice): VoiceChoice; // unknown style -> first style for the pair
export function voiceId(c: VoiceChoice): string;
export function speedValue(c: VoiceChoice): number;
export function describeVoice(c: VoiceChoice): string; // "Male, American, calm"
export function isVoiceChoice(v: unknown): v is VoiceChoice; // valid gender/accent/speed and a style that exists for the pair
export const MALE_NOTE = "Male voices sound a little less natural than female ones for now.";
export function sampleText(name: string): string; // "Hi, I'm Tom. This is how I'll sound."
```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/voice/choices.test.ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/voice/choices.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/voice/choices.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/voice/choices.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice/choices.ts src/lib/voice/choices.test.ts
git commit -m "Add the table of voices a profile can choose from"
```

---

### Task 2: Store the choice with the profile, in export files and on the demo people

**Files:**
- Modify: `src/lib/profiles/registry.ts`, `src/lib/profiles/transfer.ts`, `src/data/personas.ts`, `src/components/conversation-screen.tsx` (the two call sites of `exportProfile`/`parseImport` only)
- Test: `src/lib/profiles/registry.test.ts`, `src/lib/profiles/transfer.test.ts`

**Interfaces:**
- Consumes: Task 1 `VoiceChoice`, `DEFAULT_VOICE`, `isVoiceChoice`.
- Produces:
  - `ProfileInfo.voice?: VoiceChoice`
  - `registry.create(name: string, voice?: VoiceChoice): Promise<ProfileInfo>`
  - `registry.setVoice(id: string, voice: VoiceChoice): Promise<void>`
  - `export function profileVoice(p: ProfileInfo | null | undefined): VoiceChoice` (in registry.ts: stored and valid, else default)
  - `exportProfile(name, notes, phrases, now, suggestions = [], voice?: VoiceChoice)` writes `profile: { name, voice }`
  - `parseImport(...)` returns `{ name, notes, phrases, suggestions, voice: VoiceChoice }` (default when missing or invalid)
  - `Persona.voice: VoiceChoice`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/profiles/registry.test.ts` (use its existing `memoryKeyValue()` setup):

```ts
describe("voice", () => {
  it("keeps a profile's voice, and uses the default when none is stored", async () => {
    const kv = memoryKeyValue();
    const r = await ProfileRegistry.open(kv);
    const tom = await r.create("Tom", { gender: "male", accent: "american", style: "calm", speed: "normal" });
    const maya = await r.create("Maya");
    expect(profileVoice(r.list().find((p) => p.id === tom.id))).toEqual({ gender: "male", accent: "american", style: "calm", speed: "normal" });
    expect(profileVoice(r.list().find((p) => p.id === maya.id))).toEqual(DEFAULT_VOICE);
    await r.setVoice(maya.id, { gender: "female", accent: "british", style: "clear", speed: "faster" });
    const reopened = await ProfileRegistry.open(kv);
    expect(profileVoice(reopened.list().find((p) => p.id === maya.id))?.style).toBe("clear");
  });

  it("treats a stored value that isn't a valid choice as the default", () => {
    expect(profileVoice({ id: "x", name: "X", createdAt: 0, voice: { gender: "male", accent: "british", style: "deep", speed: "normal" } })).toEqual(DEFAULT_VOICE);
  });
});
```

Append to `src/lib/profiles/transfer.test.ts`:

```ts
describe("voice in export files", () => {
  const male = { gender: "male" as const, accent: "british" as const, style: "calm", speed: "slower" as const };

  it("carries the voice", () => {
    expect(parseImport(exportProfile("Tom", [], [], now, [], male))!.voice).toEqual(male);
  });

  it("imports older files, and files with an unknown voice, with the default", () => {
    expect(parseImport(exportProfile("Tom", [], [], now))!.voice).toEqual(DEFAULT_VOICE);
    const odd = JSON.parse(exportProfile("Tom", [], [], now, [], male));
    odd.profile.voice = { gender: "male", accent: "british", style: "robot", speed: "normal" };
    expect(parseImport(JSON.stringify(odd))!.voice).toEqual(DEFAULT_VOICE);
    odd.profile.voice = "am_michael";
    expect(parseImport(JSON.stringify(odd))!.voice).toEqual(DEFAULT_VOICE);
  });
});
```

(`now` is the constant the transfer test file already defines; import `DEFAULT_VOICE` from `@/lib/voice/choices`.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/profiles`
Expected: FAIL.

- [ ] **Step 3: Implement**

`registry.ts`:

```ts
import { DEFAULT_VOICE, isVoiceChoice, type VoiceChoice } from "@/lib/voice/choices";

export interface ProfileInfo {
  id: string;
  name: string;
  createdAt: number;
  /** How replies sound. Missing on profiles made before voices could be chosen. */
  voice?: VoiceChoice;
}

/** The profile's voice when it is a valid choice, else the default. */
export function profileVoice(p: ProfileInfo | null | undefined): VoiceChoice {
  return p && isVoiceChoice(p.voice) ? p.voice : DEFAULT_VOICE;
}
```

`create(name: string, voice?: VoiceChoice)` adds `...(voice ? { voice } : {})` to the new profile. Add:

```ts
  async setVoice(id: string, voice: VoiceChoice): Promise<void> {
    await this.write({ ...this.state, profiles: this.state.profiles.map((p) => (p.id === id ? { ...p, voice } : p)) });
  }
```

`transfer.ts`: `profile: z.object({ name: z.string(), voice: z.unknown().optional() })`; `exportProfile(..., suggestions = [], voice?: VoiceChoice)` writes `profile: { name, ...(voice ? { voice } : {}) }`; `parseImport` returns `voice: isVoiceChoice(parsed.data.profile.voice) ? parsed.data.profile.voice : DEFAULT_VOICE`.

`personas.ts`: `Persona` gains `voice: VoiceChoice`; Maya and Aisha `voice: DEFAULT_VOICE`, Tom `voice: { gender: "male", accent: "american", style: "calm", speed: "normal" }`.

`conversation-screen.tsx`: `exportActive` passes `profileVoice(active)` as the 6th argument; `importFile` creates the profile with `registry.create(registry.uniqueName(parsed.name), parsed.voice)`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/profiles src/data src/components`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/profiles src/data/personas.ts src/components/conversation-screen.tsx
git commit -m "Keep each profile's voice, in export files too"
```

---

### Task 3: The engine speaks in the current profile's voice, and can play a sample

**Files:**
- Modify: `src/lib/voice/engine.ts`, `src/lib/voice/browser.ts`
- Test: `src/lib/voice/engine.test.ts` (append)

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `VoiceEngine.speak(text: string, as?: { voice: string; speed: number }): Promise<void>`: with `as`, this one line uses that voice and speed; the current voice is unchanged.
  - `browser.ts`: `export function setCurrentVoice(choice: VoiceChoice): void`; the engine's `voice()`/`speed()` read it; the `onbeat:voice` localStorage read is removed.

- [ ] **Step 1: Write the failing tests** (append to `engine.test.ts`, reusing its fake worker, audio and basic speech helpers; read the top of the file for their names)

```ts
describe("voices", () => {
  it("asks the worker for the current voice, and for a new one after a change", async () => {
    let voice = "af_heart";
    const { engine, worker } = makeEngine({ voice: () => voice }); // the file's existing factory; add the voice override if it lacks one
    await ready(engine, worker); // bring the engine to "natural" as the other tests do
    void engine.speak("Hello");
    voice = "am_michael";
    void engine.speak("Hello");
    const asked = worker.posted.filter((m) => m.type === "generate").map((m) => m.voice);
    expect(asked).toEqual(["af_heart", "am_michael"]);
  });

  it("plays a sample in another voice without changing the current one", async () => {
    const { engine, worker } = makeEngine({ voice: () => "af_heart", speed: () => 1 });
    await ready(engine, worker);
    void engine.speak("Hi, I'm Tom.", { voice: "am_michael", speed: 1.15 });
    void engine.speak("Next reply");
    const generated = worker.posted.filter((m) => m.type === "generate").map((m) => [m.voice, m.speed]);
    expect(generated).toEqual([
      ["am_michael", 1.15],
      ["af_heart", 1],
    ]);
  });

  it("uses the sample's speed with the device voice", async () => {
    const { engine, basic } = makeEngine({ worker: null, speed: () => 1 });
    engine.load();
    await engine.speak("Hi", { voice: "am_michael", speed: 0.85 });
    expect(basic.calls.at(-1)).toEqual(["Hi", 0.85]);
  });
});
```

Adapt helper names to what `engine.test.ts` actually defines (`makeEngine`, `ready`, `worker.posted`, `basic.calls` are the intended shapes); if the file has no factory, write a small one at the top of this `describe` from the existing tests' setup.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/voice/engine.test.ts`
Expected: the sample tests FAIL (speak ignores its second argument).

- [ ] **Step 3: Implement**

`engine.ts`:

```ts
  async speak(text: string, as?: { voice: string; speed: number }): Promise<void> {
    const t = text.trim();
    if (!t) return;
    this.stop();
    const token = ++this.token;
    this.speaking = t;
    this.emit("start", t);
    try {
      const clip = this.mode === "natural" ? await withTimeout(this.clip(t, as), this.deps.naturalWaitMs ?? 1500) : null;
      if (token !== this.token) return;
      if (clip) await this.deps.audio.play(clip.samples, clip.sampleRate);
      else await this.deps.basic.speak(t, as?.speed ?? this.deps.speed());
    } finally {
      if (token === this.token && this.speaking === t) {
        this.speaking = null;
        this.emit("end", t);
      }
    }
  }
```

and `private clip(text: string, as?: { voice: string; speed: number })` uses `const voice = as?.voice ?? this.deps.voice(); const speed = as?.speed ?? this.deps.speed();` for both the cache key and the `generate` message.

`browser.ts`: replace `readVoice` with

```ts
import { DEFAULT_VOICE, speedValue, voiceId, type VoiceChoice } from "./choices";

/** The open profile's or demo's voice; the conversation screen sets it. */
let current = { voice: voiceId(DEFAULT_VOICE), speed: speedValue(DEFAULT_VOICE) };

export function setCurrentVoice(choice: VoiceChoice): void {
  current = { voice: voiceId(choice), speed: speedValue(choice) };
}
```

and construct the engine with `voice: () => current.voice, speed: () => current.speed`. Remove the `en` import if it is no longer used.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/voice`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice/engine.ts src/lib/voice/engine.test.ts src/lib/voice/browser.ts
git commit -m "Speak in the open profile's voice, and play samples in any voice"
```

---

### Task 4: Voice picker

**Files:**
- Create: `src/components/voice-picker.tsx`
- Test: `src/components/voice-picker.test.tsx`

**Interfaces:**
- Consumes: Task 1; `VoiceEngine`, `VoiceMode` types; `primaryButton`, `secondaryButton`, `hint` from `./ui`.
- Produces:

```tsx
export function VoicePicker(props: {
  value: VoiceChoice;
  onChange: (v: VoiceChoice) => void;
  /** Who the sample introduces. */
  name: string;
  voice: VoiceEngine | null;
  mode: VoiceMode;
  progress: number;
}): JSX.Element;

/** The change screen: heading "Your voice", the picker, Save and Cancel. */
export function VoiceScreen(props: {
  initial: VoiceChoice;
  name: string;
  voice: VoiceEngine | null;
  mode: VoiceMode;
  progress: number;
  onSave: (v: VoiceChoice) => void;
  onCancel: () => void;
}): JSX.Element;
```

Picker layout, top to bottom: fieldset "Voice" (Female, Male radios); fieldset "Accent" (American, British); fieldset "Style" (radios from `stylesFor`); fieldset "Speed" (Slower, Normal, Faster); the "Play a sample" button; the male note when Male is chosen; the basic-mode hint when `mode === "basic"`. Radios styled exactly like the Theme radios in `settings-panel.tsx` (`label` with `min-h-12 ... gap-3`, input `size-6 shrink-0 accent-ink`), each fieldset laid out in a row that wraps (`flex flex-wrap gap-x-6`). Changing gender or accent passes the result through `normalizeChoice`. The radio `name` attributes are made unique per picker with `useId()`.

Play: `voice?.speak(sampleText(name), { voice: voiceId(value), speed: speedValue(value) })`. Disabled while `mode === "loading"` with the text "Voice loading, <progress>%"; otherwise "Play a sample".

`VoiceScreen`: `<section aria-labelledby>` with an `h2` "Your voice" focused on mount (`tabIndex={-1}`), one line "Replies are spoken in this voice.", the picker, then Save (primary) and Cancel. Stops any sample on Cancel or Save (`voice?.stop()`).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/voice-picker.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_VOICE, MALE_NOTE, type VoiceChoice } from "@/lib/voice/choices";
import type { VoiceEngine } from "@/lib/voice/engine";
import { VoicePicker, VoiceScreen } from "./voice-picker";

const fakeVoice = () => ({ speak: vi.fn(async () => {}), stop: vi.fn() }) as unknown as VoiceEngine & { speak: ReturnType<typeof vi.fn> };

function Harness({ voice, mode = "natural" as const }: { voice: VoiceEngine; mode?: "natural" | "loading" | "basic" }) {
  const [value, setValue] = useState<VoiceChoice>(DEFAULT_VOICE);
  return <VoicePicker value={value} onChange={setValue} name="Tom" voice={voice} mode={mode} progress={40} />;
}

describe("VoicePicker", () => {
  it("changes the styles with the voice and accent, and shows the male note", async () => {
    render(<Harness voice={fakeVoice()} />);
    expect(screen.getByRole("radio", { name: "Soft" })).toBeVisible();
    await userEvent.click(screen.getByRole("radio", { name: "Male" }));
    expect(screen.getByRole("radio", { name: "Calm" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Soft" })).toBeNull();
    expect(screen.getByText(MALE_NOTE)).toBeVisible();
    await userEvent.click(screen.getByRole("radio", { name: "British" }));
    expect(screen.getAllByRole("radio").filter((r) => ["Calm", "Warm"].includes(r.getAttribute("value") === "calm" ? "Calm" : r.getAttribute("value") === "warm" ? "Warm" : ""))).toHaveLength(2);
  });

  it("plays a sample in the chosen voice and speed", async () => {
    const voice = fakeVoice();
    render(<Harness voice={voice} />);
    await userEvent.click(screen.getByRole("radio", { name: "Male" }));
    await userEvent.click(screen.getByRole("radio", { name: "Faster" }));
    await userEvent.click(screen.getByRole("button", { name: "Play a sample" }));
    expect(voice.speak).toHaveBeenCalledWith("Hi, I'm Tom. This is how I'll sound.", { voice: "am_michael", speed: 1.15 });
  });

  it("waits for the voice to load", () => {
    render(<Harness voice={fakeVoice()} mode="loading" />);
    expect(screen.getByRole("button", { name: "Voice loading, 40%" })).toBeDisabled();
  });

  it("says when the device voice will be used", () => {
    render(<Harness voice={fakeVoice()} mode="basic" />);
    expect(screen.getByText("Your device's voice will be used, and it may not match this choice.")).toBeVisible();
  });
});

describe("VoiceScreen", () => {
  it("saves the new choice", async () => {
    const onSave = vi.fn();
    render(<VoiceScreen initial={DEFAULT_VOICE} name="Tom" voice={fakeVoice()} mode="natural" progress={100} onSave={onSave} onCancel={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Your voice" })).toHaveFocus();
    await userEvent.click(screen.getByRole("radio", { name: "Male" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ gender: "male", accent: "american", style: "calm", speed: "normal" });
  });
});
```

Simplify the British assertion if it reads awkwardly: the intent is that after choosing Male + British exactly two style radios show, "Calm" and "Warm". Use `within(screen.getByRole("group", { name: "Style" })).getAllByRole("radio")` and map to accessible names.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/voice-picker.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/voice-picker.tsx
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ACCENTS, GENDERS, MALE_NOTE, SPEEDS, normalizeChoice, sampleText, speedValue, stylesFor, voiceId, type VoiceChoice } from "@/lib/voice/choices";
import type { VoiceEngine, VoiceMode } from "@/lib/voice/engine";
import { hint, primaryButton, secondaryButton } from "./ui";

interface PickerProps {
  value: VoiceChoice;
  onChange: (v: VoiceChoice) => void;
  name: string;
  voice: VoiceEngine | null;
  mode: VoiceMode;
  progress: number;
}

function Choice<T extends string>({ legend, name, options, value, onPick }: { legend: string; name: string; options: { value: T; label: string }[]; value: string; onPick: (v: T) => void }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-label font-bold">{legend}</legend>
      <div className="flex flex-wrap gap-x-6">
        {options.map((o) => (
          <label key={o.value} className="flex min-h-12 cursor-pointer items-center gap-3 text-body">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onPick(o.value)} className="size-6 shrink-0 accent-ink" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Voice, accent, style and speed, with a sample to hear the choice before keeping it. */
export function VoicePicker({ value, onChange, name, voice, mode, progress }: PickerProps) {
  const id = useId();
  const set = (patch: Partial<VoiceChoice>) => onChange(normalizeChoice({ ...value, ...patch }));
  const loading = mode === "loading";
  return (
    <div className="flex flex-col gap-5">
      <Choice legend="Voice" name={`${id}-gender`} options={GENDERS} value={value.gender} onPick={(gender) => set({ gender })} />
      <Choice legend="Accent" name={`${id}-accent`} options={ACCENTS} value={value.accent} onPick={(accent) => set({ accent })} />
      <Choice legend="Style" name={`${id}-style`} options={stylesFor(value.gender, value.accent)} value={value.style} onPick={(style) => set({ style })} />
      <Choice legend="Speed" name={`${id}-speed`} options={SPEEDS} value={value.speed} onPick={(speed) => set({ speed })} />
      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={loading || !voice}
          onClick={() => void voice?.speak(sampleText(name), { voice: voiceId(value), speed: speedValue(value) })}
          className={`${secondaryButton} self-start`}
        >
          {loading ? `Voice loading, ${progress}%` : "Play a sample"}
        </button>
        {value.gender === "male" && <p className={hint}>{MALE_NOTE}</p>}
        {mode === "basic" && <p className={hint}>Your device&apos;s voice will be used, and it may not match this choice.</p>}
      </div>
    </div>
  );
}

export function VoiceScreen({ initial, name, voice, mode, progress, onSave, onCancel }: Omit<PickerProps, "value" | "onChange"> & { initial: VoiceChoice; onSave: (v: VoiceChoice) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <section aria-labelledby="voice-heading" className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 id="voice-heading" ref={headingRef} tabIndex={-1} className="text-caption font-bold text-balance">
          Your voice
        </h2>
        <p className="text-body text-muted">Replies are spoken in this voice.</p>
      </div>
      <VoicePicker value={value} onChange={setValue} name={name} voice={voice} mode={mode} progress={progress} />
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={primaryButton}
          onClick={() => {
            voice?.stop();
            onSave(value);
          }}
        >
          Save
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => {
            voice?.stop();
            onCancel();
          }}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/voice-picker.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/voice-picker.tsx src/components/voice-picker.test.tsx
git commit -m "Add the voice picker"
```

---

### Task 5: Voice step in setup

**Files:**
- Modify: `src/components/profile-setup.tsx`, `src/components/conversation-screen.tsx` (`finishSetup` and the `ProfileSetup` props only)
- Test: `src/components/profile-components.test.tsx` (setup tests live there; append)

**Interfaces:**
- Consumes: Task 2 `registry.create(name, voice)`; Task 4 `VoicePicker`.
- Produces: `ProfileSetup` props gain `voice?: VoiceEngine | null; voiceMode?: VoiceMode; voiceProgress?: number`; `onDone(name, notes, voice: VoiceChoice)`.

Behaviour: `HEADINGS = ["Set up OnBeat", "Tell OnBeat about you", "How should your voice sound?", "Who do you talk to, and where?"]`, "Step N of 4". Step 1's Next goes to step 2 (voice). Voice step: one line "Pick how your replies will sound. You can change this any time from your profile menu or Settings.", the `VoicePicker` (name = the cleaned name), then Back, Skip (sets the choice back to `DEFAULT_VOICE` and goes on), Next, and Cancel when given. The people step's Back goes to the voice step. Finish passes the choice.

- [ ] **Step 1: Write the failing test**

```tsx
it("asks for a voice as step 3 of 4 and saves it with the profile", async () => {
  const onDone = vi.fn();
  render(<ProfileSetup onDone={onDone} voiceMode="natural" voiceProgress={100} voice={null} />);
  await userEvent.type(screen.getByLabelText("What's your name?"), "Tom");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByRole("heading", { name: "How should your voice sound?" })).toHaveFocus();
  expect(screen.getByText("Step 3 of 4")).toBeVisible();
  await userEvent.click(screen.getByRole("radio", { name: "Male" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Finish" }));
  expect(onDone).toHaveBeenCalledWith("Tom", expect.any(Array), { gender: "male", accent: "american", style: "calm", speed: "normal" });
});

it("keeps the default voice on Skip", async () => {
  const onDone = vi.fn();
  render(<ProfileSetup onDone={onDone} voiceMode="natural" voiceProgress={100} voice={null} />);
  await userEvent.type(screen.getByLabelText("What's your name?"), "Maya");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("radio", { name: "Male" }));
  await userEvent.click(screen.getByRole("button", { name: "Skip" }));
  await userEvent.click(screen.getByRole("button", { name: "Finish" }));
  expect(onDone.mock.calls[0][2]).toEqual(DEFAULT_VOICE);
});
```

Update any existing setup test that counts "of 3" or clicks Next twice to reach people and places: it now needs one more Next. Update `tests/e2e/*.spec.ts` setup helpers the same way (search for `"Finish"`): add a click on "Next" on the voice step.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/profile-components.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** as described in Behaviour. In `conversation-screen.tsx`, `finishSetup(name, made, voiceChoice)` calls `registry.create(name, voiceChoice)` and passes `voice`, `voiceMode`, `voiceProgress` to `ProfileSetup`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components` and `npx playwright test tests/e2e/profiles.spec.ts tests/e2e/learning.spec.ts`
Expected: PASS (after the setup helpers gain the extra Next).

- [ ] **Step 5: Commit**

```bash
git add src/components/profile-setup.tsx src/components/profile-components.test.tsx src/components/conversation-screen.tsx tests/e2e
git commit -m "Ask how the voice should sound during setup"
```

---

### Task 6: Use and change the voice from the conversation screen

**Files:**
- Modify: `src/components/conversation-screen.tsx`, `src/components/profile-menu.tsx`, `src/components/settings-panel.tsx`, `src/components/conversation-screen.test.tsx` (mock gains `setCurrentVoice`), `tests/e2e/helpers.ts`
- Test: `src/components/profile-components.test.tsx` (append), `tests/e2e/voice.spec.ts` (new)

**Interfaces:**
- Consumes: Tasks 2 to 4.
- Produces: view `"voice"`; `ProfileMenu` props `voiceLabel?: string; onVoice?: () => void`; `SettingsPanel` props `voiceLabel?: string; voiceBasic?: boolean; onVoice?: () => void`.

Behaviour:
- `conversation-screen.tsx`: an effect sets `setCurrentVoice(demo ? demo.voice : profileVoice(registry?.active()))` whenever the active profile, its voice, or the demo changes (depend on `demo`, `activeProfileId`, and `profilesVersion`).
- Profile menu, after "Your notes" (not in demos): a button "Voice: <describeVoice>" calling `onVoice`.
- Settings, after Theme: a row with the label "Voice", the summary, "Using your device's voice" when `voiceBasic`, and a "Change" button (aria-label "Change voice"). Hidden when `onVoice` is not given (demos, or no profile).
- The `voice` view renders `VoiceScreen` with the active profile's choice and name; Save calls `registry.setVoice(active.id, v)`, `setCurrentVoice(v)`, bumps profiles, announces "Voice saved", and returns to the conversation; Cancel returns to the conversation. Opening it stops speech (use `leaveConversation("voice")`).
- `tests/e2e/helpers.ts`: the speech stub also records `u.rate` in `window.__rates` next to `__spoken`, so e2e tests can check speed (voice ids never reach the device voice).

- [ ] **Step 1: Write the failing tests**

Menu unit test (append to `profile-components.test.tsx` with its menu helper): the menu shows "Voice: Male, American, calm" when given `voiceLabel="Male, American, calm"` and `onVoice`, and calls `onVoice` on click; with a demo open there is no Voice item.

```ts
// tests/e2e/voice.spec.ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const rates = (page: Page) => page.evaluate(() => (window as unknown as { __rates: number[] }).__rates);
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

async function setUp(page: Page, name: string, pick: (page: Page) => Promise<void>) {
  await page.getByLabel("What's your name?").fill(name);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await pick(page);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
}

test("choose a voice in setup, hear a sample, change it later", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await setUp(page, "Tom", async (p) => {
    await expect(p.getByRole("heading", { name: "How should your voice sound?" })).toBeVisible();
    expect((await new AxeBuilder({ page: p }).withTags(WCAG).analyze()).violations).toEqual([]);
    await p.getByRole("radio", { name: "Male" }).check();
    await p.getByRole("radio", { name: "Faster" }).check();
    await p.getByRole("button", { name: "Play a sample" }).click();
    await expect.poll(() => spoken(p)).toContain("Hi, I'm Tom. This is how I'll sound.");
  });
  expect((await rates(page)).at(-1)).toBe(1.15);

  // Replies are spoken at the chosen speed.
  await page.getByLabel("Type a reply").fill("Hello there");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await rates(page)).length).toBeGreaterThan(1);
  expect((await rates(page)).at(-1)).toBe(1.15);

  // Change it from the profile menu.
  await page.getByRole("button", { name: /^Tom/ }).click();
  await page.getByRole("button", { name: "Voice: Male, American, calm" }).click();
  await expect(page.getByRole("heading", { name: "Your voice" })).toBeFocused();
  await page.getByRole("radio", { name: "Slower" }).check();
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByLabel("Type a reply").fill("Again");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await rates(page)).at(-1)).toBe(0.85);

  // And from Settings.
  await page.getByText("Settings").click();
  await page.getByRole("button", { name: "Change voice" }).click();
  await expect(page.getByRole("heading", { name: "Your voice" })).toBeFocused();
  await page.getByRole("button", { name: "Cancel" }).click();
});

test("switching profile switches voice", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await setUp(page, "Tom", async (p) => p.getByRole("radio", { name: "Faster" }).check());
  await page.getByRole("button", { name: /^Tom/ }).click();
  await page.getByRole("button", { name: "New profile" }).click();
  await setUp(page, "Maya", async (p) => p.getByRole("radio", { name: "Slower" }).check());
  await page.getByLabel("Type a reply").fill("Hi");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await rates(page)).at(-1)).toBe(0.85);
  await page.getByRole("button", { name: /^Maya/ }).click();
  await page.getByRole("button", { name: "Switch to Tom" }).click();
  await page.getByLabel("Type a reply").fill("Hi");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await rates(page)).at(-1)).toBe(1.15);
});
```

Check the composer's label in `src/components/composer.tsx` and use it in place of "Type a reply" if it differs.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components` and `npx playwright test tests/e2e/voice.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** as described in Behaviour. In `conversation-screen.test.tsx`, the `@/lib/voice/browser` mock becomes `({ getBrowserVoice: () => h.voice, setCurrentVoice: vi.fn() })`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run` and `npx playwright test`
Expected: all PASS (live-model tests skipped as before).

- [ ] **Step 5: Commit**

```bash
git add src/components tests/e2e
git commit -m "Change the voice any time from the profile menu or Settings"
```

---

### Task 7: Final checks and pull request

- [ ] **Step 1:** `npm run typecheck`, `npm run lint`, `npx vitest run`, `npx playwright test`: all pass.
- [ ] **Step 2:** Whole-branch review by a fresh reviewer on the most capable model (spec, plan, `git diff feat/learning...HEAD`); fix critical and important findings with tests.
- [ ] **Step 3:** Push `feat/voice` and open a draft PR against `feat/learning` (retarget to `main` after PR #11 merges). The body lists: what changes for the user, the voice table, the decisions marked "(decided)", and one owner step before release: play each style once and say if a style word is wrong (Claude can't listen). End with the attribution line.
