# OnBeat Chatterbox voices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every spoken line uses one of 13 Chatterbox voices made on a Modal GPU, with Kokoro as the backup when Chatterbox can't make a line in time.

**Architecture:** A Python voice server on Modal (GPU snapshot, token-locked web app with `/speak` and `/warm`). A Next.js route `/api/speak` passes requests to it with the secret token. In the browser, a `VoiceRouter` takes the place of the Kokoro worker behind the existing `VoiceEngine`: it sends lines to `/api/speak` and gives them to the Kokoro worker (with each voice's Kokoro partner) when Chatterbox is waking, slow or down.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before touching routes, see AGENTS.md), TypeScript, Vitest, Playwright, Python 3.11, Modal 1.6, Chatterbox (GitHub commit `5de7a54`), Rubber Band CLI, FastAPI.

**Spec:** `docs/superpowers/specs/2026-10-01-onbeat-chatterbox-voices-design.md`

## Global Constraints

- Voices, style words, defaults, migration and Kokoro partners exactly as in the spec's decisions 2, 5, 6 and 7.
- Voice ids, identical in `src/lib/voice/choices.ts` and `voice-server/voices.py`: `f_us_bright f_us_clear f_us_calm f_us_warm f_ca_lively f_gb_calm f_gb_bright m_us_deep m_ca_warm m_gb_calm m_gb_warm m_gb_bright m_gb_gentle`.
- Speeds: Slower 0.85, Normal 1, Faster 1.15. Normal is not processed; the others go through Rubber Band R3 (`--fine`).
- `/api/speak`: same origin only; 90 lines and 10 wake calls a minute per address; text 1 to 300 characters; 25 s timeout to Modal; nothing stored or logged.
- Vercel settings: `MODAL_SPEAK_URL`, `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`. Modal headers: `Modal-Key`, `Modal-Secret`.
- Modal: T4, `max_containers=2`, `scaledown_window=300`, GPU memory snapshot.
- Timing: a line being said waits up to 6 s for Chatterbox when awake; prepared replies wait for Chatterbox; two failed lines in a row, or a failed wake call, mean down; retry every 60 s; 5 minutes without a line means asleep.
- Status wording: "Waking your voice…", "Your voice is ready.", "Using the backup voice.". Backup notice: "Your voice wasn't ready in time, so the backup voice said that."
- Writing style for README and docs: plain developer voice, no emoji, no em dashes.
- Claude asks the owner before every `modal deploy` and never reads the Modal token secret.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work in the worktree `C:/Users/hujai/onbeat-chatterbox`, branch `feat/chatterbox-voices`. Unit tests: `npx vitest run <path>`. Typecheck: `npm run typecheck`. Lint: `npm run lint`. E2E: `npx playwright test <file>` (port 3100; run one Playwright job at a time on this machine).

## Review Focus

1. A typed line longer than 300 characters: the backup voice says it, and it doesn't count toward "down" (Task 5).
2. A 4xx answer from `/api/speak` (bad request, rate limited) is not an outage: the line goes to the backup and the failure count stays (Task 5).
3. An empty or malformed WAV is a failed line, never played as silence (Tasks 3 and 5).
4. The tab sits idle past 5 minutes: the next line wakes Chatterbox and a line being said goes to the backup instead of waiting on a cold start (Task 5).
5. Kokoro can't load (downloads blocked) and Chatterbox is down: the engine drops to the device voice instead of staying in "loading" forever (Task 5, and Task 8's e2e default).

---

### Task 1: The new voice table and the migration of old choices

**Files:**
- Modify: `src/lib/voice/choices.ts`
- Test: `src/lib/voice/choices.test.ts`

**Interfaces:**
- Produces: `type Accent = "american" | "canadian" | "british"`; `interface VoiceChoice { gender; accent; style: string; speed; v: 2 }`; `DEFAULT_VOICE`; `ACCENTS` (three entries); `stylesFor(gender, accent): Style[]` where `Style = { value: string; label: string; id: string; backup: string }`; `voiceId(c): string` (Chatterbox id); `backupVoice(id: string): string` (Kokoro id; `af_heart` for an unknown id); `VOICE_IDS: readonly string[]`; `migrateChoice(v: unknown): VoiceChoice | null`; `isVoiceChoice`, `normalizeChoice`, `speedValue`, `describeVoice`, `sampleText` keep their signatures. `MALE_NOTE` is removed.

The `v: 2` marker is needed because some old and new choices share a spelling with different meanings: old "Female, American, Warm" was Kokoro Heart and becomes Bright; new "Female, American, Warm" is p362. A stored value without `v: 2` is an old Kokoro choice.

- [ ] **Step 1: Replace the tests**

Replace the whole of `src/lib/voice/choices.test.ts` with:

```ts
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/voice/choices.test.ts`
Expected: FAIL (`migrateChoice`, `backupVoice`, `VOICE_IDS` don't exist; style lists differ).

- [ ] **Step 3: Rewrite `src/lib/voice/choices.ts`**

Replace the whole file with:

```ts
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
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/voice/choices.test.ts`
Expected: PASS. (The typecheck fails elsewhere until Task 2; that's expected.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice/choices.ts src/lib/voice/choices.test.ts
git commit -m "Voice table for the 13 Chatterbox voices, with Kokoro partners and old-choice migration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Use the new choices in profiles, imports, demos and the picker

**Files:**
- Modify: `src/lib/profiles/registry.ts:16-18`
- Modify: `src/lib/profiles/transfer.ts:4,105-107`
- Modify: `src/data/personas.ts:76`
- Modify: `src/components/voice-picker.tsx:4,66`
- Test: `src/lib/profiles/registry.test.ts:110-125`, `src/lib/profiles/transfer.test.ts:94-104`, `src/components/voice-picker.test.tsx:20-32`, `tests/e2e/voice.spec.ts:42`

**Interfaces:**
- Consumes: `migrateChoice`, `DEFAULT_VOICE`, `VoiceChoice` (with `v: 2`) from Task 1.
- Produces: `profileVoice(p)` returns a migrated `VoiceChoice`; `parseImport(...).voice` is migrated.

- [ ] **Step 1: Update the tests**

In `src/lib/profiles/registry.test.ts`, replace the `describe("voice", ...)` block with:

```ts
describe("voice", () => {
  it("keeps a profile's voice, and uses the default when none is stored", async () => {
    const kv = memoryKeyValue();
    const r = await ProfileRegistry.open(kv);
    const tom = await r.create("Tom", { gender: "male", accent: "canadian", style: "warm", speed: "normal", v: 2 });
    const maya = await r.create("Maya");
    expect(profileVoice(r.list().find((p) => p.id === tom.id))).toEqual({ gender: "male", accent: "canadian", style: "warm", speed: "normal", v: 2 });
    expect(profileVoice(r.list().find((p) => p.id === maya.id))).toEqual(DEFAULT_VOICE);
    await r.setVoice(maya.id, { gender: "female", accent: "british", style: "bright", speed: "faster", v: 2 });
    const reopened = await ProfileRegistry.open(kv);
    expect(profileVoice(reopened.list().find((p) => p.id === maya.id))?.style).toBe("bright");
  });

  it("moves a stored Kokoro choice to the nearest Chatterbox voice", () => {
    const old = { gender: "male", accent: "american", style: "calm", speed: "slower" } as unknown as import("@/lib/voice/choices").VoiceChoice;
    expect(profileVoice({ id: "x", name: "X", createdAt: 0, voice: old })).toEqual({ gender: "male", accent: "american", style: "deep", speed: "slower", v: 2 });
  });

  it("treats a stored value that isn't a valid choice as the default", () => {
    const odd = { gender: "male", accent: "british", style: "deep", speed: "normal" } as unknown as import("@/lib/voice/choices").VoiceChoice;
    expect(profileVoice({ id: "x", name: "X", createdAt: 0, voice: odd })).toEqual(DEFAULT_VOICE);
  });
});
```

In `src/lib/profiles/transfer.test.ts`, replace the `describe("voice in export files", ...)` block's first two lines and add a migration test, so the block reads:

```ts
describe("voice in export files", () => {
  const male = { gender: "male" as const, accent: "british" as const, style: "gentle", speed: "slower" as const, v: 2 as const };

  it("carries the voice", () => {
    expect(parseImport(exportProfile("Tom", [], [], now, [], male))!.voice).toEqual(male);
  });

  it("moves a Kokoro voice in an older file to the nearest Chatterbox voice", () => {
    const file = JSON.parse(exportProfile("Tom", [], [], now));
    file.profile.voice = { gender: "female", accent: "british", style: "clear", speed: "normal" };
    expect(parseImport(JSON.stringify(file))!.voice).toEqual({ gender: "female", accent: "british", style: "bright", speed: "normal", v: 2 });
  });
```

and keep the existing `it("imports older files, and files with an unknown voice, with the default", ...)` test that follows unchanged.

In `src/components/voice-picker.test.tsx`, replace the first test with:

```tsx
  it("changes the styles with the voice and accent", async () => {
    render(<Harness voice={fakeVoice()} />);
    expect(screen.getByRole("radio", { name: "Clear" })).toBeVisible();
    await userEvent.click(screen.getByRole("radio", { name: "Male" }));
    expect(screen.getByRole("radio", { name: "Deep" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Clear" })).toBeNull();
    expect(screen.queryByText(/less natural/)).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Canadian" }));
    expect(screen.getByRole("radio", { name: "Warm" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "British" }));
    const styleRadios = within(screen.getByRole("group", { name: "Style" })).getAllByRole("radio");
    const styleNames = styleRadios.map((r) => r.closest("label")?.textContent ?? "");
    expect(styleNames).toEqual(["Calm", "Warm", "Bright", "Gentle"]);
  });
```

and remove `MALE_NOTE` from that file's import line. In `tests/e2e/voice.spec.ts`, change `"Voice: Male, American, calm"` to `"Voice: Male, American, deep"`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/profiles src/components/voice-picker.test.tsx`
Expected: FAIL (old Kokoro choice not migrated; the male note still shows).

- [ ] **Step 3: Implement**

`src/lib/profiles/registry.ts`: change the import to `import { DEFAULT_VOICE, migrateChoice, type VoiceChoice } from "@/lib/voice/choices";` and the function to:

```ts
/** The profile's voice, with an older Kokoro choice moved to the nearest Chatterbox voice; else the default. */
export function profileVoice(p: ProfileInfo | null | undefined): VoiceChoice {
  return migrateChoice(p?.voice) ?? DEFAULT_VOICE;
}
```

`src/lib/profiles/transfer.ts`: change the import to `import { DEFAULT_VOICE, migrateChoice, type VoiceChoice } from "@/lib/voice/choices";` and replace lines 106-107 with:

```ts
  // Rebuilt field by field, so nothing else in the file is stored with the profile.
  const voice: VoiceChoice = migrateChoice(given) ?? DEFAULT_VOICE;
```

`src/data/personas.ts:76`: `voice: { gender: "male", accent: "american", style: "deep", speed: "normal", v: 2 },`

`src/components/voice-picker.tsx`: remove `MALE_NOTE` from the import and delete the line `{value.gender === "male" && <p className={hint}>{MALE_NOTE}</p>}`.

- [ ] **Step 4: Run tests, typecheck and lint**

Run: `npx vitest run src/lib src/components && npm run typecheck && npm run lint`
Expected: PASS everywhere. If the typecheck names another object literal of type `VoiceChoice` without `v: 2`, add `v: 2` to it.

- [ ] **Step 5: Commit**

```bash
git add src tests/e2e/voice.spec.ts
git commit -m "Move stored, imported and demo voices to the Chatterbox table; drop the male-voice note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Decode the server's WAV into samples

**Files:**
- Create: `src/lib/voice/wav.ts`
- Test: `src/lib/voice/wav.test.ts`

**Interfaces:**
- Produces: `decodeWav(buffer: ArrayBuffer): { samples: Float32Array; sampleRate: number }`. Throws on anything that isn't 16-bit PCM WAV with at least one sample. Multi-channel audio is averaged to mono.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { decodeWav } from "./wav";

function wav(samples: number[], sampleRate = 24000, channels = 1, bits = 16): ArrayBuffer {
  const data = samples.length * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, bits, true);
  text(36, "data");
  v.setUint32(40, data, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, s, true));
  return buf;
}

describe("decodeWav", () => {
  it("reads 16-bit mono PCM", () => {
    const { samples, sampleRate } = decodeWav(wav([0, 16384, -32768, 32767]));
    expect(sampleRate).toBe(24000);
    expect(Array.from(samples)).toEqual([0, 0.5, -1, 32767 / 32768]);
  });

  it("averages stereo to mono", () => {
    expect(Array.from(decodeWav(wav([16384, 0, -16384, -16384], 24000, 2)).samples)).toEqual([0.25, -0.5]);
  });

  it("refuses empty audio, other formats and junk", () => {
    expect(() => decodeWav(wav([]))).toThrow();
    expect(() => decodeWav(wav([1, 2], 24000, 1, 8))).toThrow();
    expect(() => decodeWav(new TextEncoder().encode("not audio").buffer as ArrayBuffer)).toThrow();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/voice/wav.test.ts`
Expected: FAIL ("Cannot find module './wav'").

- [ ] **Step 3: Implement `src/lib/voice/wav.ts`**

```ts
/** The voice server's clip (16-bit PCM WAV) as samples the engine can play. Throws on anything else, including an empty clip. */
export function decodeWav(buffer: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
  const v = new DataView(buffer);
  const tag = (at: number) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
  if (buffer.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let channels = 0;
  let sampleRate = 0;
  let at = 12;
  while (at + 8 <= buffer.byteLength) {
    const id = tag(at);
    const size = v.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      const format = v.getUint16(body, true);
      channels = v.getUint16(body + 2, true);
      sampleRate = v.getUint32(body + 4, true);
      const bits = v.getUint16(body + 14, true);
      if (format !== 1 || bits !== 16 || channels < 1) throw new Error("not 16-bit PCM");
    } else if (id === "data") {
      if (!channels) throw new Error("data before format");
      const frames = Math.floor(Math.min(size, buffer.byteLength - body) / (2 * channels));
      if (frames < 1) throw new Error("empty clip");
      const samples = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        for (let ch = 0; ch < channels; ch++) sum += v.getInt16(body + (f * channels + ch) * 2, true);
        samples[f] = sum / channels / 32768;
      }
      return { samples, sampleRate };
    }
    at = body + size + (size % 2);
  }
  throw new Error("no audio data");
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/lib/voice/wav.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice/wav.ts src/lib/voice/wav.test.ts
git commit -m "Decode the voice server's WAV clips

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Engine: several lines at once, urgent lines, backup clips and the voice source

**Files:**
- Modify: `src/lib/voice/messages.ts`
- Modify: `src/lib/voice/engine.ts`
- Test: `src/lib/voice/engine.test.ts` (add tests; existing ones stay)

**Interfaces:**
- Produces in `messages.ts`: `type VoiceSource = "waking" | "awake" | "down"`; `generate` gains `urgent?: boolean`; `audio` gains `backup?: boolean`; new message `{ type: "source"; source: VoiceSource }`.
- Produces in `engine.ts`: `VoiceEngineDeps.parallel?: number` (default 1); `engine.source: VoiceSource` (starts `"waking"`); events `source: VoiceSource` and `backup: string` (the reply text said by a backup clip, not emitted while the source is `"down"` or for samples). On `source: "awake"`, cached backup clips are dropped and the replies from the last `prepareReplies` call are prepared again.

- [ ] **Step 1: Write the failing tests**

Add inside `describe("VoiceEngine", ...)` in `src/lib/voice/engine.test.ts`:

```ts
  it("keeps up to `parallel` lines in progress, the line being said first, and marks it urgent", () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic } = fakeBasic();
    const v = new VoiceEngine({ ...deps(w, a.audio, basic), naturalWaitMs: 5000, parallel: 3 });
    v.load();
    w.emit({ type: "ready" });
    const gens = () => w.sent.filter((m): m is Extract<VoiceWorkerRequest, { type: "generate" }> => m.type === "generate");
    v.prepareReplies(["A", "B", "C", "D"]);
    expect(gens().map((g) => g.text)).toEqual(["A", "B", "C"]);
    expect(gens().every((g) => !g.urgent)).toBe(true);
    void v.speak("Typed");
    expect(gens().map((g) => g.text)).toEqual(["A", "B", "C"]);
    w.emit({ type: "audio", id: gens()[0].id, samples: new Float32Array(1), sampleRate: 24000 });
    expect(gens().at(-1)).toMatchObject({ text: "Typed", urgent: true });
  });

  it("says when a reply came from the backup voice, but not while the backup is the only voice", async () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic } = fakeBasic();
    const v = new VoiceEngine({ ...deps(w, a.audio, basic), naturalWaitMs: 5000 });
    const backups: string[] = [];
    v.on("backup", (t) => backups.push(t));
    v.load();
    w.emit({ type: "ready" });
    const first = v.speak("One");
    w.emit({ type: "audio", id: w.lastGenerate().id, samples: new Float32Array(1), sampleRate: 24000, backup: true });
    await vi.waitFor(() => expect(a.played).toEqual([1]));
    a.finish();
    await first;
    expect(backups).toEqual(["One"]);
    w.emit({ type: "source", source: "down" });
    const second = v.speak("Two");
    w.emit({ type: "audio", id: w.lastGenerate().id, samples: new Float32Array(1), sampleRate: 24000, backup: true });
    await vi.waitFor(() => expect(a.played).toEqual([1, 1]));
    a.finish();
    await second;
    expect(backups).toEqual(["One"]);
  });

  it("reports the source, and once Chatterbox is awake remakes replies that came from the backup", () => {
    const w = new FakeWorker();
    const a = fakeAudio();
    const { basic } = fakeBasic();
    const v = new VoiceEngine({ ...deps(w, a.audio, basic), parallel: 3 });
    const sources: string[] = [];
    v.on("source", (s) => sources.push(s));
    expect(v.source).toBe("waking");
    v.load();
    w.emit({ type: "ready" });
    v.prepareReplies(["A", "B"]);
    const [a1, b1] = w.sent.filter((m) => m.type === "generate") as Extract<VoiceWorkerRequest, { type: "generate" }>[];
    w.emit({ type: "audio", id: a1.id, samples: new Float32Array(1), sampleRate: 24000, backup: true });
    w.emit({ type: "audio", id: b1.id, samples: new Float32Array(1), sampleRate: 24000 });
    w.emit({ type: "source", source: "awake" });
    expect(sources).toEqual(["awake"]);
    expect(v.source).toBe("awake");
    const texts = w.sent.flatMap((m) => (m.type === "generate" ? [m.text] : []));
    expect(texts).toEqual(["A", "B", "A"]);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/voice/engine.test.ts`
Expected: FAIL (`parallel` ignored, no `backup`/`source` events, type errors on the new message fields).

- [ ] **Step 3: Update `src/lib/voice/messages.ts`**

```ts
/** Where spoken lines come from: Chatterbox waking up, Chatterbox ready, or Chatterbox unavailable (the backup speaks). */
export type VoiceSource = "waking" | "awake" | "down";

export type VoiceWorkerRequest =
  | { type: "load" }
  | { type: "generate"; id: number; text: string; voice: string; speed: number; urgent?: boolean };

export type VoiceWorkerMessage =
  | { type: "ready" }
  | { type: "progress"; value: number }
  | { type: "audio"; id: number; samples: Float32Array; sampleRate: number; backup?: boolean }
  | { type: "error"; id?: number; message: string }
  | { type: "source"; source: VoiceSource };
```

- [ ] **Step 4: Update `src/lib/voice/engine.ts`**

Make these changes:

1. Import: `import type { VoiceSource, VoiceWorkerMessage } from "./messages";`
2. `type Clip = { samples: Float32Array; sampleRate: number; backup?: boolean };`
3. Add to `Events`: `source: VoiceSource;` and `backup: string;` with the doc comment line: `backup names a reply said by the backup voice because Chatterbox couldn't make it in time.`
4. Add to `VoiceEngineDeps`: `/** Lines in progress at once. The Kokoro worker makes one at a time; the router can do more. */ parallel?: number;`
5. In the class: add `source: VoiceSource = "waking";`, `private lastReplies: string[] = [];`, add `source: new Set(), backup: new Set()` to `listeners`, and replace `private busy: number | null = null;` with `private busy = new Set<number>();` (update its comment to "The clips the worker is making now.").
6. `prepareReplies`: first line becomes `this.lastReplies = texts;` (before the mode check).
7. In `play`, replace `if (clip) await this.deps.audio.play(clip.samples, clip.sampleRate);` with:

```ts
      if (clip) {
        if (clip.backup && !now.sample && this.source !== "down") this.emit("backup", t);
        await this.deps.audio.play(clip.samples, clip.sampleRate);
      }
```

8. Replace `pump`, `settled` and the start of `onWorkerMessage`'s handling as follows:

```ts
  /** Sends queued clips while the worker has room. */
  private pump(): void {
    if (!this.deps.worker) return;
    while (this.busy.size < (this.deps.parallel ?? 1)) {
      const job = this.queue.shift();
      if (!job) return;
      this.busy.add(job.id);
      this.deps.worker.postMessage({ type: "generate", id: job.id, text: job.text, voice: job.voice, speed: job.speed, urgent: job.urgent });
    }
  }
```

```ts
  /** A clip finished or failed: the worker has room for the next one. */
  private settled(id: number): void {
    this.busy.delete(id);
    this.pump();
  }
```

In `onWorkerMessage`: in `case "audio"`, resolve with `{ samples: msg.samples, sampleRate: msg.sampleRate, ...(msg.backup ? { backup: true } : {}) }`; in the `error` branch with no id replace `this.busy = null;` with `this.busy.clear();`; and add:

```ts
      case "source": {
        this.source = msg.source;
        this.emit("source", msg.source);
        if (msg.source === "awake") {
          // Never replay a backup clip once the chosen voice is available.
          for (const [key, entry] of this.clips) if (entry.value?.backup) this.clips.delete(key);
          this.prepareReplies(this.lastReplies);
        }
        return;
      }
```

- [ ] **Step 5: Run the engine tests**

Run: `npx vitest run src/lib/voice/engine.test.ts`
Expected: PASS, including the existing "makes one clip at a time" test (parallel defaults to 1).

- [ ] **Step 6: Commit**

```bash
git add src/lib/voice/messages.ts src/lib/voice/engine.ts src/lib/voice/engine.test.ts
git commit -m "Voice engine: several lines at once, urgent lines, backup clips and the voice source

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The router between the engine, `/api/speak` and Kokoro

**Files:**
- Create: `src/lib/voice/router.ts`
- Test: `src/lib/voice/router.test.ts`

**Interfaces:**
- Consumes: `backupVoice` (Task 1), `decodeWav` (Task 3), message types (Task 4), `WorkerLike`.
- Produces:

```ts
export class SpeakError extends Error { constructor(readonly status: number) }
export interface RouterDeps {
  kokoro: WorkerLike | null;
  /** Resolves with a WAV clip; rejects with SpeakError(status) for an HTTP error, anything else for a network failure or abort. */
  speak: (req: { text: string; voice: string; speed: number }, signal: AbortSignal) => Promise<ArrayBuffer>;
  /** True when the voice server answered that it's ready. */
  warm: () => Promise<boolean>;
  lineWaitMs?: number;     // 6000
  preparedWaitMs?: number; // 25000
  idleMs?: number;         // 300000
  retryMs?: number;        // 60000
}
export class VoiceRouter implements WorkerLike { ... }
export const MAX_LINE = 300;
```

Rules (from the spec, plus Review Focus 1, 2 and 5):
- `load`: forwards `load` to Kokoro and sends one wake call.
- A failed wake call means down. A successful one means awake.
- `ready` goes to the engine once, when Kokoro is ready or Chatterbox is awake, whichever comes first. `error` (no id) goes to the engine when Kokoro has failed and Chatterbox is down; after that, `ready` can be sent again when Chatterbox wakes.
- Awake: send to Chatterbox with a 6 s deadline for urgent lines, 25 s for prepared ones. Success: audio. A 5xx, network failure or timeout counts as a failure (two in a row: down); a 4xx doesn't count. After any failure, the line goes to Kokoro.
- Lines longer than 300 characters go straight to Kokoro and don't count.
- Waking: urgent lines go to Kokoro if it's ready; everything else is held until awake (then sent to Chatterbox) or down (then sent to Kokoro).
- Down: everything goes to Kokoro; a wake call every 60 s.
- Awake but no line for 5 minutes: asleep. The next line starts a wake call and is handled as "waking".
- A Kokoro clip goes to the engine with `backup: true`. If Kokoro isn't available, the line gets an `error` for its id, and the engine's device-voice fallback covers it.

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerLike } from "@/lib/worker-like";
import type { VoiceWorkerMessage, VoiceWorkerRequest } from "./messages";
import { SpeakError, VoiceRouter, type RouterDeps } from "./router";

/** A 16-bit mono WAV with `n` samples. */
function wav(n = 4): ArrayBuffer {
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); text(8, "WAVE"); text(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 24000, true);
  v.setUint32(28, 48000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, "data"); v.setUint32(40, n * 2, true);
  return buf;
}

class FakeKokoro implements WorkerLike {
  sent: VoiceWorkerRequest[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage(m: unknown) { this.sent.push(m as VoiceWorkerRequest); }
  terminate() {}
  emit(m: VoiceWorkerMessage) { this.onmessage?.({ data: m } as MessageEvent); }
  gens() { return this.sent.filter((m): m is Extract<VoiceWorkerRequest, { type: "generate" }> => m.type === "generate"); }
}

function setUp(over: Partial<RouterDeps> = {}) {
  const kokoro = new FakeKokoro();
  let warmAnswer: (ok: boolean) => void = () => {};
  const warm = vi.fn(() => new Promise<boolean>((r) => (warmAnswer = r)));
  const speak = vi.fn(async () => wav());
  const router = new VoiceRouter({ kokoro, speak, warm, ...over });
  const got: VoiceWorkerMessage[] = [];
  router.onmessage = (e) => got.push(e.data as VoiceWorkerMessage);
  const gen = (id: number, text: string, urgent = false) => router.postMessage({ type: "generate", id, text, voice: "m_gb_gentle", speed: 1, urgent });
  return { kokoro, warm, speak, router, got, gen, wake: (ok: boolean) => warmAnswer(ok) };
}
const types = (got: VoiceWorkerMessage[]) => got.map((m) => (m.type === "source" ? `source:${m.source}` : m.type));

describe("VoiceRouter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("loads Kokoro and wakes Chatterbox; ready once, when either is ready", async () => {
    const t = setUp();
    t.router.postMessage({ type: "load" });
    expect(t.kokoro.sent).toEqual([{ type: "load" }]);
    expect(t.warm).toHaveBeenCalledTimes(1);
    t.kokoro.emit({ type: "progress", value: 40 });
    t.kokoro.emit({ type: "ready" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toEqual(["source:waking", "progress", "ready", "source:awake"]));
  });

  it("makes lines with Chatterbox once awake", async () => {
    const t = setUp();
    t.router.postMessage({ type: "load" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:awake"));
    t.gen(1, "Hello", true);
    await vi.waitFor(() => expect(t.got.at(-1)).toMatchObject({ type: "audio", id: 1, sampleRate: 24000 }));
    expect(t.speak).toHaveBeenCalledWith({ text: "Hello", voice: "m_gb_gentle", speed: 1 }, expect.any(AbortSignal));
    expect(t.got.at(-1)).not.toHaveProperty("backup");
  });

  it("while waking, a line being said goes to Kokoro and prepared replies wait for Chatterbox", async () => {
    const t = setUp();
    t.router.postMessage({ type: "load" });
    t.kokoro.emit({ type: "ready" });
    t.gen(1, "Now", true);
    t.gen(2, "Later");
    expect(t.kokoro.gens()).toEqual([{ type: "generate", id: 1, text: "Now", voice: "bm_george", speed: 1, urgent: true }]);
    t.kokoro.emit({ type: "audio", id: 1, samples: new Float32Array(2), sampleRate: 24000 });
    expect(t.got.at(-1)).toMatchObject({ type: "audio", id: 1, backup: true });
    expect(t.speak).not.toHaveBeenCalled();
    t.wake(true);
    await vi.waitFor(() => expect(t.speak).toHaveBeenCalledTimes(1));
    expect(t.speak.mock.calls[0][0]).toMatchObject({ text: "Later" });
  });

  it("a slow line being said goes to Kokoro after 6 s", async () => {
    const t = setUp({ speak: vi.fn((_r, signal: AbortSignal) => new Promise<ArrayBuffer>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))) });
    t.router.postMessage({ type: "load" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:awake"));
    t.gen(1, "Slow", true);
    await vi.advanceTimersByTimeAsync(5900);
    expect(t.kokoro.gens()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(t.kokoro.gens().map((g) => g.text)).toEqual(["Slow"]);
  });

  it("two failed lines mean down; a wake call every 60 s brings it back", async () => {
    const t = setUp({ speak: vi.fn(async () => { throw new SpeakError(503); }) });
    t.router.postMessage({ type: "load" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:awake"));
    t.gen(1, "One", true);
    await vi.waitFor(() => expect(t.kokoro.gens()).toHaveLength(1));
    expect(types(t.got)).not.toContain("source:down");
    t.gen(2, "Two", true);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:down"));
    t.gen(3, "Three");
    expect(t.kokoro.gens().map((g) => g.text)).toEqual(["One", "Two", "Three"]);
    expect(t.warm).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.warm).toHaveBeenCalledTimes(2);
    t.wake(true);
    await vi.waitFor(() => expect(t.got.at(-1)).toEqual({ type: "source", source: "awake" }));
  });

  it("a 4xx answer or a line over 300 characters goes to Kokoro without counting toward down", async () => {
    const t = setUp({ speak: vi.fn(async () => { throw new SpeakError(429); }) });
    t.router.postMessage({ type: "load" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:awake"));
    for (let i = 1; i <= 3; i++) t.gen(i, `Line ${i}`, true);
    t.gen(4, "x".repeat(301), true);
    await vi.waitFor(() => expect(t.kokoro.gens()).toHaveLength(4));
    expect(t.speak).toHaveBeenCalledTimes(3);
    expect(types(t.got)).not.toContain("source:down");
  });

  it("an empty clip from the server is a failed line, not silence", async () => {
    const t = setUp({ speak: vi.fn(async () => wav(0)) });
    t.router.postMessage({ type: "load" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:awake"));
    t.gen(1, "Hi", true);
    await vi.waitFor(() => expect(t.kokoro.gens().map((g) => g.text)).toEqual(["Hi"]));
    expect(t.got.some((m) => m.type === "audio" && m.id === 1)).toBe(false);
  });

  it("after 5 idle minutes, the next line wakes Chatterbox and is said by Kokoro meanwhile", async () => {
    const t = setUp();
    t.router.postMessage({ type: "load" });
    t.kokoro.emit({ type: "ready" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toContain("source:awake"));
    await vi.advanceTimersByTimeAsync(300_001);
    t.gen(1, "Back again", true);
    expect(t.warm).toHaveBeenCalledTimes(2);
    expect(t.kokoro.gens().map((g) => g.text)).toEqual(["Back again"]);
    expect(t.speak).not.toHaveBeenCalled();
  });

  it("with Kokoro failed and Chatterbox down, tells the engine no voice is available", async () => {
    const t = setUp();
    t.router.postMessage({ type: "load" });
    t.kokoro.emit({ type: "error", message: "blocked" });
    expect(types(t.got)).not.toContain("error");
    t.wake(false);
    await vi.waitFor(() => expect(types(t.got)).toEqual(["source:waking", "source:down", "error"]));
    t.gen(1, "Hi", true);
    expect(t.got.at(-1)).toMatchObject({ type: "error", id: 1 });
  });

  it("works with no Kokoro at all", async () => {
    const t = setUp({ kokoro: null });
    t.router.postMessage({ type: "load" });
    t.wake(true);
    await vi.waitFor(() => expect(types(t.got)).toEqual(["source:waking", "ready", "source:awake"]));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/voice/router.test.ts`
Expected: FAIL ("Cannot find module './router'").

- [ ] **Step 3: Implement `src/lib/voice/router.ts`**

```ts
import type { WorkerLike } from "@/lib/worker-like";
import { backupVoice } from "./choices";
import type { VoiceSource, VoiceWorkerMessage, VoiceWorkerRequest } from "./messages";
import { decodeWav } from "./wav";

/** An HTTP error from /api/speak. 4xx answers are about the request, not an outage. */
export class SpeakError extends Error {
  constructor(readonly status: number) {
    super(`speak failed with ${status}`);
  }
}

export const MAX_LINE = 300;

export interface RouterDeps {
  kokoro: WorkerLike | null;
  /** Resolves with a WAV clip; rejects with SpeakError(status) for an HTTP error, anything else for a network failure or abort. */
  speak: (req: { text: string; voice: string; speed: number }, signal: AbortSignal) => Promise<ArrayBuffer>;
  /** True when the voice server answered that it's ready. */
  warm: () => Promise<boolean>;
  lineWaitMs?: number;
  preparedWaitMs?: number;
  idleMs?: number;
  retryMs?: number;
}

type Generate = Extract<VoiceWorkerRequest, { type: "generate" }>;

/**
 * Sits where the Kokoro worker used to: lines go to Chatterbox through /api/speak, and to the
 * Kokoro worker (in each voice's Kokoro partner) when Chatterbox is waking, slow or down.
 */
export class VoiceRouter implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  /** null until the first wake call, so that call's "waking" reaches the engine. Treated like "waking". */
  private source: VoiceSource | null = null;
  private kokoroReady = false;
  private kokoroFailed: boolean;
  private readySent = false;
  private failures = 0;
  private lastLineAt = 0;
  private held: Generate[] = [];
  private kokoroJobs = new Set<number>();
  private waking: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: RouterDeps) {
    this.kokoroFailed = !deps.kokoro;
    if (deps.kokoro) deps.kokoro.onmessage = (e: MessageEvent) => this.fromKokoro(e.data as VoiceWorkerMessage);
  }

  postMessage(message: unknown): void {
    const msg = message as VoiceWorkerRequest;
    if (msg.type === "load") {
      this.deps.kokoro?.postMessage({ type: "load" });
      void this.wake();
      return;
    }
    this.route(msg);
  }

  terminate(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.deps.kokoro?.terminate();
  }

  private post(message: VoiceWorkerMessage): void {
    this.onmessage?.({ data: message } as MessageEvent);
  }

  private setSource(source: VoiceSource): void {
    if (this.source === source) return;
    this.source = source;
    this.post({ type: "source", source });
  }

  private sendReady(): void {
    if (this.readySent) return;
    this.readySent = true;
    this.post({ type: "ready" });
  }

  private wake(): Promise<void> {
    this.waking ??= (async () => {
      this.setSource("waking");
      const ok = await this.deps.warm().catch(() => false);
      this.waking = null;
      if (ok) this.setAwake();
      else this.setDown();
    })();
    return this.waking;
  }

  private setAwake(): void {
    this.failures = 0;
    this.lastLineAt = Date.now();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.sendReady();
    this.setSource("awake");
    const held = this.held;
    this.held = [];
    for (const job of held) void this.viaChatterbox(job);
  }

  private setDown(): void {
    this.setSource("down");
    const held = this.held;
    this.held = [];
    for (const job of held) this.viaKokoro(job);
    if (!this.retryTimer)
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.wake();
      }, this.deps.retryMs ?? 60_000);
    this.noVoiceLeft();
  }

  /** Kokoro failed and Chatterbox is down: the engine falls back to the device voice. */
  private noVoiceLeft(): void {
    if (!this.kokoroFailed || this.source !== "down") return;
    this.readySent = false;
    this.post({ type: "error", message: "No natural voice is available" });
  }

  private route(job: Generate): void {
    if (job.text.length > MAX_LINE) return this.viaKokoro(job);
    if (this.source === "awake" && Date.now() - this.lastLineAt > (this.deps.idleMs ?? 300_000)) void this.wake();
    if (this.source === "awake") return void this.viaChatterbox(job);
    if (this.source === "down") return this.viaKokoro(job);
    if (job.urgent && this.kokoroReady && !this.kokoroFailed) return this.viaKokoro(job);
    this.held.push(job);
  }

  private async viaChatterbox(job: Generate): Promise<void> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), job.urgent ? (this.deps.lineWaitMs ?? 6000) : (this.deps.preparedWaitMs ?? 25_000));
    try {
      const { samples, sampleRate } = decodeWav(await this.deps.speak({ text: job.text, voice: job.voice, speed: job.speed }, ctrl.signal));
      this.failures = 0;
      this.lastLineAt = Date.now();
      this.post({ type: "audio", id: job.id, samples, sampleRate });
    } catch (err) {
      const aboutTheRequest = err instanceof SpeakError && err.status >= 400 && err.status < 500;
      if (!aboutTheRequest && ++this.failures >= 2) this.setDown();
      this.viaKokoro(job);
    } finally {
      clearTimeout(timer);
    }
  }

  private viaKokoro(job: Generate): void {
    if (!this.deps.kokoro || this.kokoroFailed) {
      this.post({ type: "error", id: job.id, message: "No backup voice" });
      return;
    }
    this.kokoroJobs.add(job.id);
    this.deps.kokoro.postMessage({ type: "generate", id: job.id, text: job.text, voice: backupVoice(job.voice), speed: job.speed, urgent: job.urgent });
  }

  private fromKokoro(msg: VoiceWorkerMessage): void {
    switch (msg.type) {
      case "ready":
        this.kokoroReady = true;
        this.sendReady();
        return;
      case "progress":
        this.post(msg);
        return;
      case "audio":
        this.kokoroJobs.delete(msg.id);
        this.post({ ...msg, backup: true });
        return;
      case "error":
        if (msg.id === undefined) {
          this.kokoroFailed = true;
          for (const id of this.kokoroJobs) this.post({ type: "error", id, message: msg.message });
          this.kokoroJobs.clear();
          this.noVoiceLeft();
        } else {
          this.kokoroJobs.delete(msg.id);
          this.post(msg);
        }
        return;
      case "source":
        return;
    }
  }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/voice/router.test.ts`
Expected: PASS. If the idle test sees `speak` called, check that `route` handles the asleep case before the awake branch.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice/router.ts src/lib/voice/router.test.ts
git commit -m "Voice router: Chatterbox through /api/speak, Kokoro partner as the backup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Wire the router into the browser, the status line and the notices

**Files:**
- Modify: `src/lib/voice/browser.ts`
- Modify: `src/components/voice-status.tsx`
- Modify: `src/components/conversation-screen.tsx` (voice effect near line 133, `VoiceStatus` use near line 726, constants near line 75)
- Modify: `src/components/settings-panel.tsx:72` (the file holding `SettingsPanel`; find it with `grep -rl "export function SettingsPanel" src/components`)
- Create: `src/components/voice-status.test.tsx`
- Test: `src/components/conversation-screen.test.tsx` (the fake voice)

**Interfaces:**
- Consumes: `VoiceRouter`, `SpeakError` (Task 5); engine `source` property and `source`/`backup` events (Task 4).
- Produces: `speakViaServer(req, signal): Promise<ArrayBuffer>`, `warmServer(): Promise<boolean>` in `browser.ts`; `voiceStatusText(mode: VoiceMode, source: VoiceSource, progress: number): string` and `VoiceStatus({ mode, source, progress })` in `voice-status.tsx`.

- [ ] **Step 1: Write the failing test for the status text**

`src/components/voice-status.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { voiceStatusText } from "./voice-status";

describe("voiceStatusText", () => {
  it("says what the voice is doing", () => {
    expect(voiceStatusText("loading", "waking", 10)).toBe("Waking your voice…");
    expect(voiceStatusText("natural", "waking", 100)).toBe("Waking your voice…");
    expect(voiceStatusText("natural", "awake", 100)).toBe("Your voice is ready.");
    expect(voiceStatusText("natural", "down", 100)).toBe("Using the backup voice.");
    expect(voiceStatusText("loading", "down", 40)).toBe("Getting the backup voice ready… 40%. The basic voice works in the meantime.");
    expect(voiceStatusText("basic", "down", 0)).toBe("Using the basic voice.");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/voice-status.test.tsx`
Expected: FAIL (`voiceStatusText` is not exported).

- [ ] **Step 3: Rewrite `src/components/voice-status.tsx`**

```tsx
import type { VoiceMode } from "@/lib/voice/engine";
import type { VoiceSource } from "@/lib/voice/messages";

export function voiceStatusText(mode: VoiceMode, source: VoiceSource, progress: number): string {
  if (source === "awake") return "Your voice is ready.";
  if (mode === "basic") return "Using the basic voice.";
  if (source === "down")
    return mode === "natural" ? "Using the backup voice." : `Getting the backup voice ready… ${Math.max(0, Math.min(100, progress))}%. The basic voice works in the meantime.`;
  return "Waking your voice…";
}

export function VoiceStatus({ mode, source, progress }: { mode: VoiceMode; source: VoiceSource; progress: number }) {
  return <p className="text-label text-muted">{voiceStatusText(mode, source, progress)}</p>;
}
```

- [ ] **Step 4: Wire `browser.ts`**

Add the imports `import { SpeakError, VoiceRouter } from "./router";`, then add above `let engine`:

```ts
/** One line from the voice server, through OnBeat's own route. */
export async function speakViaServer(req: { text: string; voice: string; speed: number }, signal: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch("/api/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req), signal });
  if (!res.ok) throw new SpeakError(res.status);
  return res.arrayBuffer();
}

/** Starts the voice server; true once it answers that it's ready. */
export async function warmServer(): Promise<boolean> {
  try {
    return (await fetch("/api/speak?warm=1", { method: "POST" })).ok;
  } catch {
    return false;
  }
}
```

and replace the body of `getBrowserVoice` after the `if (engine) return engine;` line with:

```ts
  const kokoro =
    typeof Worker === "undefined" ? null : new Worker(new URL("../../workers/voice.worker.ts", import.meta.url), { type: "module" });
  // The engine's load() sends the wake call, so the voice server starts when the app opens.
  const worker = new VoiceRouter({ kokoro, speak: speakViaServer, warm: warmServer });
  engine = new VoiceEngine({ worker, audio: webAudioOut(), basic: browserBasicSpeech(), voice: () => current.voice, speed: () => current.speed, parallel: 3 });
  return engine;
```

- [ ] **Step 5: Wire `conversation-screen.tsx`**

1. Next to `VOICE_FALLBACK`, add: `const VOICE_BACKUP = "Your voice wasn't ready in time, so the backup voice said that.";`
2. Next to `voiceMode`, add:

```ts
  const subscribeSource = useCallback((cb: () => void) => (voice ? voice.on("source", cb) : () => {}), [voice]);
  const voiceSource = useSyncExternalStore<VoiceSource>(subscribeSource, () => voice?.source ?? "waking", () => "waking");
```

and import the type with `import type { VoiceSource } from "@/lib/voice/messages";`.
3. In the voice effect's `offs` array, add `voice.on("backup", () => dispatch({ type: "notice", text: VOICE_BACKUP })),`.
4. Change `<VoiceStatus mode={voiceMode} progress={voiceProgress} />` to `<VoiceStatus mode={voiceMode} source={voiceSource} progress={voiceProgress} />`.

- [ ] **Step 6: Settings note**

In the `SettingsPanel` file, directly under the voice row's summary line (next to the `voiceBasic` line), add:

```tsx
            <p className="text-label text-muted">Lines you say are sent through OnBeat to our voice service to be spoken. They aren&apos;t stored.</p>
```

- [ ] **Step 7: Update the fake voice in `src/components/conversation-screen.test.tsx`**

Add `source: new Set(),` and `backup: new Set(),` to `listeners`, and `source: "waking" as const,` to the `voice` object. Then add this test inside the file's main `describe` (it uses the file's existing render helper and `h.emit`; use the same helper the neighbouring tests use to open a profile):

```tsx
  it("tells the user when the backup voice said a line", async () => {
    await renderReady();
    act(() => h.emit("backup", "Hello"));
    expect(await screen.findByText("Your voice wasn't ready in time, so the backup voice said that.")).toBeVisible();
  });
```

If the file's helper isn't called `renderReady`, use the one the "fallback" notice test uses (search the file for `VOICE_FALLBACK` or "device's voice said that").

- [ ] **Step 8: Run tests, typecheck and lint**

Run: `npx vitest run src/components src/lib/voice && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src
git commit -m "Use the voice router in the browser; status line and backup notice; Settings privacy note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The `/api/speak` route

**Files:**
- Create: `src/app/api/speak/route.ts`
- Test: `src/app/api/speak/route.test.ts`

**Interfaces:**
- Consumes: `VOICE_IDS` (Task 1), `isSameOrigin`, `clientIp`, `json` (`src/lib/server/guard.ts`), `createRateLimiter`.
- Produces: `POST /api/speak` (`{text, voice, speed}` to `audio/wav`, else 400/403/429/503) and `POST /api/speak?warm=1` (204 or 503). Read `node_modules/next/dist/docs/` for route handlers and `maxDuration` before writing it (AGENTS.md).

- [ ] **Step 1: Write the failing tests**

Model them on `src/app/api/transcribe/route.test.ts` (read it first for how it imports the route fresh and stubs `fetch` and env). The tests:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const URL_BASE = "https://example--onbeat-voice-voice-web.modal.run";
let POST: (r: Request) => Promise<Response>;

function req(body: unknown, opts: { warm?: boolean; origin?: string; ip?: string } = {}) {
  return new Request(`http://localhost/api/speak${opts.warm ? "?warm=1" : ""}`, {
    method: "POST",
    headers: { host: "localhost", origin: opts.origin ?? "http://localhost", "x-forwarded-for": opts.ip ?? "1.2.3.4", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("MODAL_SPEAK_URL", URL_BASE);
  vi.stubEnv("MODAL_TOKEN_ID", "wk-id");
  vi.stubEnv("MODAL_TOKEN_SECRET", "ws-secret");
  ({ POST } = await import("./route"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/api/speak", () => {
  it("passes a valid line to the voice server with the token and returns the WAV", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([82, 73, 70, 70]), { status: 200, headers: { "content-type": "audio/wav" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(req({ text: " Hello ", voice: "m_gb_gentle", speed: 0.85 }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([82, 73, 70, 70]));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${URL_BASE}/speak`);
    expect(init.headers).toMatchObject({ "Modal-Key": "wk-id", "Modal-Secret": "ws-secret" });
    expect(JSON.parse(init.body as string)).toEqual({ text: "Hello", voice: "m_gb_gentle", speed: 0.85 });
  });

  it("refuses other sites and bad requests", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await POST(req({ text: "Hi", voice: "m_gb_gentle", speed: 1 }, { origin: "https://evil.example" }))).status).toBe(403);
    for (const body of [{ text: "", voice: "m_gb_gentle", speed: 1 }, { text: "x".repeat(301), voice: "m_gb_gentle", speed: 1 }, { text: "Hi", voice: "af_heart", speed: 1 }, { text: "Hi", voice: "m_gb_gentle", speed: 2 }, "junk"])
      expect((await POST(req(body))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("limits each address to 90 lines a minute", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })));
    for (let i = 0; i < 90; i++) expect((await POST(req({ text: "Hi", voice: "m_gb_gentle", speed: 1 }, { ip: "9.9.9.9" }))).status).toBe(200);
    expect((await POST(req({ text: "Hi", voice: "m_gb_gentle", speed: 1 }, { ip: "9.9.9.9" }))).status).toBe(429);
  });

  it("answers 503 when settings are missing, the server fails or times out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    expect((await POST(req({ text: "Hi", voice: "m_gb_gentle", speed: 1 }))).status).toBe(503);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); }));
    expect((await POST(req({ text: "Hi", voice: "m_gb_gentle", speed: 1 }))).status).toBe(503);
    vi.stubEnv("MODAL_TOKEN_SECRET", "");
    vi.resetModules();
    ({ POST } = await import("./route"));
    expect((await POST(req({ text: "Hi", voice: "m_gb_gentle", speed: 1 }))).status).toBe(503);
  });

  it("wakes the voice server, at most 10 times a minute per address", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(req(undefined, { warm: true, ip: "5.5.5.5" }))).status).toBe(204);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(`${URL_BASE}/warm`);
    for (let i = 0; i < 9; i++) await POST(req(undefined, { warm: true, ip: "5.5.5.5" }));
    expect((await POST(req(undefined, { warm: true, ip: "5.5.5.5" }))).status).toBe(429);
    fetchMock.mockImplementation(async () => new Response(null, { status: 502 }));
    expect((await POST(req(undefined, { warm: true, ip: "6.6.6.6" }))).status).toBe(503);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/app/api/speak/route.test.ts`
Expected: FAIL ("Cannot find module './route'").

- [ ] **Step 3: Implement `src/app/api/speak/route.ts`**

```ts
import { clientIp, isSameOrigin, json } from "@/lib/server/guard";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { VOICE_IDS } from "@/lib/voice/choices";

const MAX_TEXT = 300;
const SPEEDS = new Set([0.85, 1, 1.15]);
// A cold start with the GPU snapshot is about 11 s, 21 s at worst so far.
const TIMEOUT_MS = 25_000;
export const maxDuration = 30;
// Three replies per turn of the other person plus what the user says.
const lines = createRateLimiter({ limit: 90, windowMs: 60_000 });
const wakes = createRateLimiter({ limit: 10, windowMs: 60_000 });

/**
 * Spoken lines: text to the Chatterbox voice server on Modal, which returns a WAV. The Modal
 * token stays on the server, so only OnBeat can spend the voice credit. Nothing is stored or logged.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, 403);
  const warm = new URL(request.url).searchParams.get("warm") === "1";
  if (!(warm ? wakes : lines).check(clientIp(request))) return json({ error: "rate_limited" }, 429);

  const base = process.env.MODAL_SPEAK_URL;
  const id = process.env.MODAL_TOKEN_ID;
  const secret = process.env.MODAL_TOKEN_SECRET;
  if (!base || !id || !secret) return json({ error: "unavailable" }, 503);
  const headers = { "Modal-Key": id, "Modal-Secret": secret, "content-type": "application/json" };

  if (warm) {
    try {
      const res = await fetch(`${base}/warm`, { method: "POST", headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      return res.ok ? new Response(null, { status: 204, headers: { "cache-control": "no-store" } }) : json({ error: "unavailable" }, 503);
    } catch {
      return json({ error: "unavailable" }, 503);
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const { text, voice, speed } = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const line = typeof text === "string" ? text.trim() : "";
  if (!line || line.length > MAX_TEXT || typeof voice !== "string" || !VOICE_IDS.includes(voice) || typeof speed !== "number" || !SPEEDS.has(speed))
    return json({ error: "invalid_request" }, 400);

  try {
    const res = await fetch(`${base}/speak`, { method: "POST", headers, body: JSON.stringify({ text: line, voice, speed }), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return json({ error: "unavailable" }, 503);
    return new Response(await res.arrayBuffer(), { status: 200, headers: { "content-type": "audio/wav", "cache-control": "no-store" } });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/app/api/speak/route.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/speak
git commit -m "/api/speak: pass lines and wake calls to the voice server with the Modal token

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: End-to-end tests

**Files:**
- Modify: `tests/e2e/helpers.ts` (`prepare`)
- Create: `tests/e2e/chatterbox.spec.ts`

**Interfaces:**
- Consumes: the whole browser side (Tasks 1 to 7).

- [ ] **Step 1: Default `/api/speak` to unavailable in `prepare`**

In `tests/e2e/helpers.ts`, inside `prepare`, after the Hugging Face abort, add:

```ts
  // No voice server in tests unless a test asks for one: with Kokoro's download blocked too,
  // the app falls back to the (stubbed) browser speech engine as before.
  await page.route("**/api/speak**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }));
```

- [ ] **Step 2: Run the existing e2e suites to confirm nothing changed**

Run: `npx playwright test tests/e2e/voice.spec.ts tests/e2e/conversation.spec.ts tests/e2e/profiles.spec.ts`
Expected: PASS (the device-voice behaviour these tests rely on is unchanged).

- [ ] **Step 3: Write `tests/e2e/chatterbox.spec.ts`**

```ts
import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

/** 0.1 s of silence as 24 kHz 16-bit mono WAV. */
function silence(): Buffer {
  const n = 2400;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24);
  b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  return b;
}

async function voiceServer(page: Page, speak: "ok" | "fail") {
  const bodies: { text: string; voice: string; speed: number }[] = [];
  await page.route("**/api/speak**", async (route) => {
    if (route.request().url().includes("warm=1")) return route.fulfill({ status: 204 });
    bodies.push(route.request().postDataJSON());
    return speak === "ok" ? route.fulfill({ status: 200, contentType: "audio/wav", body: silence() }) : route.fulfill({ status: 503, body: "{}" });
  });
  return bodies;
}

async function setUpTom(page: Page) {
  await page.getByLabel("What's your name?").fill("Tom");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("radio", { name: "Male", exact: true }).check();
}

test("the picker offers the Chatterbox voices, and lines are made by the voice server", async ({ page }) => {
  await prepare(page);
  const bodies = await voiceServer(page, "ok");
  await page.goto("/");
  await setUpTom(page);
  await expect(page.getByRole("radio", { name: "Canadian" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Deep" })).toBeChecked();
  await expect(page.getByText("Your voice is ready.")).toBeVisible();
  await page.getByRole("button", { name: "Play a sample" }).click();
  await expect.poll(() => bodies.map((b) => b.voice)).toContain("m_us_deep");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByLabel("Type a reply").fill("Hello there");
  await page.keyboard.press("Enter");
  await expect.poll(() => bodies.map((b) => b.text)).toContain("Hello there");
  expect(await spoken(page)).not.toContain("Hello there");
});

test("when the voice server fails a line, the device voice says it and the screen says so", async ({ page }) => {
  await prepare(page);
  await voiceServer(page, "fail");
  await page.goto("/");
  await setUpTom(page);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByLabel("Type a reply").fill("Hello there");
  await page.keyboard.press("Enter");
  await expect.poll(() => spoken(page)).toContain("Hello there");
  await expect(page.getByText("Your voice wasn't ready in time, so your device's voice said that.")).toBeVisible();
});
```

If the status text renders only on the conversation screen, move the `"Your voice is ready."` assertion to after "Finish".

- [ ] **Step 4: Run it**

Run: `npx playwright test tests/e2e/chatterbox.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e
git commit -m "E2E: Chatterbox voices through a faked voice server, and the device-voice fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Voice server building blocks (no GPU needed)

**Files:**
- Create: `voice-server/voices.py`, `voice-server/speed.py`, `voice-server/test_voices.py`, `voice-server/test_speed.py`, `voice-server/requirements-dev.txt`
- Create: `voice-server/refs/` (12 WAVs) and `voice-server/refs/README.md`
- Create: `voice-server/.gitignore` with `__pycache__/` and `.pytest_cache/`

**Interfaces:**
- Produces: `VOICES: dict[str, tuple[str, str | None]]` (id to model `"turbo"|"nano"` and reference name or None); `SPEEDS = (0.85, 1.0, 1.15)`; `MAX_TEXT = 300`; `check_request(body: dict) -> tuple[str, str, float]` (raises `ValueError`); `rubberband_args(speed: float, src: str, dst: str) -> list[str]`; `change_speed(samples: np.ndarray, sr: int, speed: float) -> np.ndarray`; `to_wav_bytes(samples: np.ndarray, sr: int) -> bytes`. `RUBBERBAND` env var overrides the binary (the laptop uses `C:/Users/hujai/chatterbox-local/tools/rubberband-4.0.0-gpl-executable-windows/rubberband-r3.exe`).

- [ ] **Step 1: Copy the reference clips and write their credit**

```bash
mkdir -p voice-server/refs
for s in p341 p294 p362 p303 p228 p250 p311 p363 p226 p232 p258 p273; do cp C:/Users/hujai/chatterbox-local/refs/$s.wav voice-server/refs/; done
ls voice-server/refs | wc -l   # 12
```

`voice-server/refs/README.md`:

```markdown
# Reference recordings

Chatterbox copies a voice from a short recording. Each file here is 10 to 15 seconds of one speaker's lines, joined, trimmed and saved as 24 kHz 16-bit mono.

The recordings come from the CSTR VCTK Corpus (Yamagishi, Veaux and MacDonald, University of Edinburgh, 2019), licensed under CC BY 4.0: https://datashare.ed.ac.uk/handle/10283/3443

| File | Speaker | OnBeat voice |
|---|---|---|
| p341.wav | female, American (Ohio) | Female, American, Clear |
| p294.wav | female, American (San Francisco) | Female, American, Calm |
| p362.wav | female, American | Female, American, Warm |
| p303.wav | female, Canadian (Toronto) | Female, Canadian, Lively |
| p228.wav | female, English (Southern England) | Female, British, Calm |
| p250.wav | female, English (South-East England) | Female, British, Bright |
| p311.wav | male, American (Iowa) | Male, American, Deep |
| p363.wav | male, Canadian (Toronto) | Male, Canadian, Warm |
| p226.wav | male, English (Surrey) | Male, British, Calm |
| p232.wav | male, English (Southern England) | Male, British, Warm |
| p258.wav | male, English (Southern England) | Male, British, Bright |
| p273.wav | male, English (Suffolk) | Male, British, Gentle |

Female, American, Bright is Chatterbox's built-in voice and has no file here.
```

- [ ] **Step 2: Write the failing tests**

`voice-server/requirements-dev.txt`:

```
pytest
numpy
soundfile
```

`voice-server/test_voices.py`:

```python
import pathlib

import pytest

from voices import MAX_TEXT, SPEEDS, VOICES, check_request

ROOT = pathlib.Path(__file__).parent
APP_IDS = ["f_us_bright", "f_us_clear", "f_us_calm", "f_us_warm", "f_ca_lively", "f_gb_calm", "f_gb_bright",
           "m_us_deep", "m_ca_warm", "m_gb_calm", "m_gb_warm", "m_gb_bright", "m_gb_gentle"]


def test_same_ids_as_the_app():
    assert list(VOICES) == APP_IDS
    app = (ROOT.parent / "src/lib/voice/choices.ts").read_text()
    for voice_id in APP_IDS:
        assert f'id: "{voice_id}"' in app


def test_models_and_reference_files():
    assert VOICES["f_us_bright"] == ("turbo", None)
    assert {m for m, _ in VOICES.values()} == {"turbo", "nano"}
    assert [v for v, (m, _) in VOICES.items() if m == "nano"] == ["m_gb_calm", "m_gb_warm", "m_gb_bright", "m_gb_gentle"]
    for _, ref in VOICES.values():
        if ref:
            assert (ROOT / "refs" / f"{ref}.wav").is_file()


def test_check_request():
    assert check_request({"text": " Hello ", "voice": "m_gb_gentle", "speed": 0.85}) == ("Hello", "m_gb_gentle", 0.85)
    assert check_request({"text": "Hi", "voice": "f_us_bright", "speed": 1}) == ("Hi", "f_us_bright", 1.0)
    assert SPEEDS == (0.85, 1.0, 1.15)
    for bad in [{}, {"text": "", "voice": "f_us_bright", "speed": 1}, {"text": "x" * (MAX_TEXT + 1), "voice": "f_us_bright", "speed": 1},
                {"text": "Hi", "voice": "af_heart", "speed": 1}, {"text": "Hi", "voice": "f_us_bright", "speed": 2}, {"text": 5, "voice": "f_us_bright", "speed": 1}]:
        with pytest.raises(ValueError):
            check_request(bad)
```

`voice-server/test_speed.py`:

```python
import io
import os
import shutil

import numpy as np
import pytest
import soundfile as sf

from speed import change_speed, rubberband_args, to_wav_bytes


def test_rubberband_args_use_the_r3_engine_and_keep_pitch():
    assert rubberband_args(0.85, "in.wav", "out.wav")[1:] == ["--quiet", "--fine", "--tempo", "0.85", "in.wav", "out.wav"]


def test_normal_speed_is_untouched():
    x = np.linspace(-0.5, 0.5, 2400, dtype=np.float32)
    assert change_speed(x, 24000, 1.0) is x


def test_wav_bytes_are_16_bit_mono():
    data, sr = sf.read(io.BytesIO(to_wav_bytes(np.zeros(2400, dtype=np.float32), 24000)))
    info = sf.info(io.BytesIO(to_wav_bytes(np.zeros(2400, dtype=np.float32), 24000)))
    assert (sr, len(data), info.channels, info.subtype) == (24000, 2400, 1, "PCM_16")


@pytest.mark.skipif(not shutil.which(os.environ.get("RUBBERBAND", "rubberband")), reason="Rubber Band not installed")
def test_slower_is_longer_and_faster_is_shorter():
    t = np.arange(24000) / 24000
    tone = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    assert abs(len(change_speed(tone, 24000, 0.85)) - 24000 / 0.85) < 600
    assert abs(len(change_speed(tone, 24000, 1.15)) - 24000 / 1.15) < 600
```

- [ ] **Step 3: Run them to see them fail**

Run (from `voice-server/`): `C:/Users/hujai/chatterbox-local/.venv/Scripts/python -m pip install -q pytest && RUBBERBAND=C:/Users/hujai/chatterbox-local/tools/rubberband-4.0.0-gpl-executable-windows/rubberband-r3.exe C:/Users/hujai/chatterbox-local/.venv/Scripts/python -m pytest -q`
Expected: FAIL (`voices` and `speed` modules don't exist).

- [ ] **Step 4: Implement**

`voice-server/voices.py`:

```python
"""The 13 OnBeat voices: app id -> (Chatterbox model, reference clip in refs/ or None for the built-in voice).

The ids match src/lib/voice/choices.ts. Picked by ear by the owner on 2026-10-01."""

VOICES: dict[str, tuple[str, str | None]] = {
    "f_us_bright": ("turbo", None),
    "f_us_clear": ("turbo", "p341"),
    "f_us_calm": ("turbo", "p294"),
    "f_us_warm": ("turbo", "p362"),
    "f_ca_lively": ("turbo", "p303"),
    "f_gb_calm": ("turbo", "p228"),
    "f_gb_bright": ("turbo", "p250"),
    "m_us_deep": ("turbo", "p311"),
    "m_ca_warm": ("turbo", "p363"),
    "m_gb_calm": ("nano", "p226"),
    "m_gb_warm": ("nano", "p232"),
    "m_gb_bright": ("nano", "p258"),
    "m_gb_gentle": ("nano", "p273"),
}
SPEEDS = (0.85, 1.0, 1.15)
MAX_TEXT = 300


def check_request(body: dict) -> tuple[str, str, float]:
    """(text, voice, speed) from a /speak body, or ValueError."""
    text, voice, speed = body.get("text"), body.get("voice"), body.get("speed")
    if not isinstance(text, str) or not text.strip() or len(text.strip()) > MAX_TEXT:
        raise ValueError("text")
    if voice not in VOICES:
        raise ValueError("voice")
    if not isinstance(speed, (int, float)) or float(speed) not in SPEEDS:
        raise ValueError("speed")
    return text.strip(), voice, float(speed)
```

`voice-server/speed.py`:

```python
"""Speed changes that keep the pitch (Rubber Band's R3 engine; WSOLA warbled on slowed Turbo voices), and WAV output."""
import io
import os
import subprocess
import tempfile

import numpy as np
import soundfile as sf

RUBBERBAND = os.environ.get("RUBBERBAND", "rubberband")


def rubberband_args(speed: float, src: str, dst: str) -> list[str]:
    return [RUBBERBAND, "--quiet", "--fine", "--tempo", f"{speed:g}", src, dst]


def change_speed(samples: np.ndarray, sr: int, speed: float) -> np.ndarray:
    if speed == 1.0:
        return samples
    with tempfile.TemporaryDirectory() as d:
        src, dst = os.path.join(d, "in.wav"), os.path.join(d, "out.wav")
        sf.write(src, samples, sr, subtype="FLOAT")
        subprocess.run(rubberband_args(speed, src, dst), check=True, capture_output=True)
        out, _ = sf.read(dst, dtype="float32")
    return out if out.ndim == 1 else out.mean(axis=1)


def to_wav_bytes(samples: np.ndarray, sr: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, np.clip(samples, -1.0, 1.0), sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()
```

- [ ] **Step 5: Run the tests to see them pass**

Run the same command as Step 3.
Expected: PASS (4 + 3 tests, with the Rubber Band test running because `RUBBERBAND` points at the Windows build).

- [ ] **Step 6: Commit**

```bash
git add voice-server
git commit -m "Voice server: voice table, request checks, speed changes and WAV output, with the VCTK references

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The Modal app, its deploy and the check script

**Files:**
- Create: `voice-server/app.py`, `voice-server/check.py`, `voice-server/README.md`

**Interfaces:**
- Consumes: `VOICES`, `check_request` (voices.py), `change_speed`, `to_wav_bytes` (speed.py).
- Produces: Modal app `onbeat-voice`, class `Voice` with `make(text, voice, speed) -> bytes` (a `modal.method`, used by `check.py`) and a token-locked web app with `POST /speak` and `POST /warm`. Its URL (printed by `modal deploy`, of the form `https://muazhuja01--onbeat-voice-voice-web.modal.run`) is `MODAL_SPEAK_URL`.

- [ ] **Step 1: Write `voice-server/app.py`**

```python
"""OnBeat's voice server on Modal: Chatterbox Nano and Turbo on a T4, all 13 voices ready in a GPU memory snapshot.

Deploy from the repo root (Windows needs PYTHONUTF8=1):
    python -m modal deploy voice-server/app.py
"""
import pathlib
import sys
import time

import modal

CHATTERBOX = "chatterbox-tts @ git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))  # so add_local_python_source finds voices.py and speed.py when deploying from the repo root


def download_models():
    from chatterbox.tts_turbo import ChatterboxTurboTTS

    for nano in (True, False):
        ChatterboxTurboTTS.from_pretrained(device="cpu", nano=nano)


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "rubberband-cli")
    .pip_install(CHATTERBOX, "soundfile", "fastapi[standard]")
    .run_function(download_models)
    .add_local_dir(HERE / "refs", "/refs", ignore=lambda p: not str(p).endswith(".wav"))
    .add_local_python_source("voices", "speed")
)
app = modal.App("onbeat-voice", image=image)


@app.cls(
    gpu="T4",
    max_containers=2,
    scaledown_window=300,
    timeout=600,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)
class Voice:
    @modal.enter(snap=True)
    def load(self):
        import numpy as np
        from chatterbox.tts_turbo import ChatterboxTurboTTS

        from voices import VOICES

        started = time.time()
        self.models, self.conds = {}, {}
        for name in ("nano", "turbo"):
            m = ChatterboxTurboTTS.from_pretrained(device="cuda", nano=name == "nano")
            norm = m.norm_loudness  # returns float64, which breaks the tokenizer's float32 mel filters
            m.norm_loudness = lambda w, sr, norm=norm: norm(w, sr).astype(np.float32)
            builtin = m.conds
            for voice_id, (model, ref) in VOICES.items():
                if model != name:
                    continue
                if ref:
                    m.prepare_conditionals(f"/refs/{ref}.wav")
                self.conds[voice_id] = m.conds if ref else builtin
            m.conds = builtin
            m.generate("Warming up.")
            self.models[name] = m
        print(f"voices ready in {time.time() - started:.1f} s")

    def _make(self, text: str, voice: str, speed: float) -> bytes:
        import torch

        from speed import change_speed, to_wav_bytes
        from voices import VOICES

        m = self.models[VOICES[voice][0]]
        m.conds = self.conds[voice]
        wav = m.generate(text)
        torch.cuda.synchronize()
        samples = wav.squeeze(0).cpu().numpy()
        return to_wav_bytes(change_speed(samples, m.sr, speed), m.sr)

    @modal.method()
    def make(self, text: str, voice: str, speed: float) -> bytes:
        from voices import check_request

        return self._make(*check_request({"text": text, "voice": voice, "speed": speed}))

    @modal.asgi_app(requires_proxy_auth=True)
    def web(self):
        from fastapi import FastAPI, HTTPException, Response

        from voices import check_request

        api = FastAPI()

        @api.post("/warm")
        def warm():
            # The models load before the first request is served, so answering means ready.
            return Response(status_code=204)

        @api.post("/speak")
        def speak(body: dict):
            try:
                text, voice, speed = check_request(body)
            except ValueError as err:
                raise HTTPException(status_code=400, detail=str(err)) from err
            return Response(self._make(text, voice, speed), media_type="audio/wav")

        return api
```

- [ ] **Step 2: Write `voice-server/check.py`**

```python
"""Checks the deployed voice server: every voice at every speed, timing, the cost so far, and optionally a Whisper pass.

    python voice-server/check.py [--out DIR] [--whisper]

Run it after the server has been idle for 6 minutes to also measure a cold start (the first line)."""
import argparse
import io
import os
import re
import subprocess
import sys
import time

import modal

sys.path.insert(0, os.path.dirname(__file__))
from voices import SPEEDS, VOICES  # noqa: E402

LINE = "Physio moved to Thursdays at eleven, so I'll see you then."


def words(s: str) -> list[str]:
    return re.sub(r"[^a-z' ]", " ", s.lower().replace("11", "eleven")).split()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="C:/Users/hujai/Music/chatterbox-test/deployed")
    p.add_argument("--whisper", action="store_true")
    args = p.parse_args()
    os.makedirs(args.out, exist_ok=True)
    voice = modal.Cls.from_name("onbeat-voice", "Voice")()
    asr = None
    if args.whisper:
        from transformers import pipeline

        asr = pipeline("automatic-speech-recognition", model="openai/whisper-small.en", device="cpu")
    first = True
    for voice_id in VOICES:
        for speed in SPEEDS:
            t = time.time()
            wav = voice.make.remote(LINE, voice_id, speed)
            took = time.time() - t
            label = "cold start" if first else "line"
            first = False
            path = f"{args.out}/{voice_id}-{speed:g}.wav"
            with open(path, "wb") as f:
                f.write(wav)
            note = ""
            if asr:
                import librosa

                y, _ = librosa.load(io.BytesIO(wav), sr=16000)
                heard = asr({"raw": y, "sampling_rate": 16000})["text"]
                missing = len(set(words(LINE)) - set(words(heard)))
                note = f" | heard: {heard.strip()}" + (" | CHECK" if missing > 1 else "")
            print(f"{voice_id:12} {speed:<5g} {label}: {took:.2f} s{note}", flush=True)
    print(subprocess.run([sys.executable, "-m", "modal", "billing", "summary"], capture_output=True, text=True, env={**os.environ, "PYTHONUTF8": "1"}).stdout)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Write `voice-server/README.md`**

```markdown
# OnBeat voice server

Chatterbox (https://github.com/resemble-ai/chatterbox, MIT) on a Modal T4 GPU. The app's `/api/speak` route calls it with a Modal proxy token; nothing else can.

- `voices.py`: the 13 voices (ids match `src/lib/voice/choices.ts`).
- `speed.py`: Slower and Faster with Rubber Band's R3 engine, so the pitch stays.
- `app.py`: the Modal app. Both models and all voices load into a GPU memory snapshot, so a cold start takes about 11 s. At most 2 machines; each stops 5 minutes after its last line.
- `refs/`: the reference recordings (VCTK, CC BY 4.0; see `refs/README.md`).
- `check.py`: makes every voice at every speed on the deployed server and prints timings and the cost so far.

## Commands (from the repo root, Windows needs `PYTHONUTF8=1`)

    python -m modal deploy voice-server/app.py
    python voice-server/check.py --whisper
    python -m pytest voice-server -q

Deploying doesn't happen on push. The first cold start after a deploy takes about 2.5 minutes while Modal makes the snapshot.

## Settings in Vercel

`MODAL_SPEAK_URL` (the URL `modal deploy` prints for `Voice.web`), `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` (a proxy token from Modal's dashboard, Settings, Proxy Auth Tokens).
```

- [ ] **Step 4: Ask the owner, then deploy**

Ask: "The voice server is ready to deploy to your Modal account. The first deploy builds the image and makes the snapshot, using a few cents of the free credit. Deploy now?" On yes, run from the worktree root:

```bash
PYTHONUTF8=1 C:/Users/hujai/chatterbox-local/.venv/Scripts/python -m modal deploy voice-server/app.py
```

Expected: "App deployed", with a URL for `Voice.web`. Write the URL into `.superpowers/progress.md` in the main checkout (it isn't a secret).

- [ ] **Step 5: Check it**

```bash
PYTHONUTF8=1 C:/Users/hujai/chatterbox-local/.venv/Scripts/python voice-server/check.py --whisper
```

Expected: 39 lines (13 voices by 3 speeds). The first, the snapshot-making cold start, takes up to 150 s; the others take under 2 s each. At most a few `CHECK` flags (Iowa's "Physio" is a known quirk). Then wait 6 minutes and run it again: the first line is now the real cold start, about 11 s to 21 s. Check that `curl -s -o /dev/null -w "%{http_code}" -X POST <URL>/warm` answers 401 without the token.

- [ ] **Step 6: Commit**

```bash
git add voice-server
git commit -m "Voice server Modal app with GPU snapshot, token-locked /speak and /warm, and a check script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Settings, docs, preview check and the owner's listening

**Files:**
- Modify: `README.md` (privacy lines near line 17-21, the voice text in lines 5, 27, 46 and 56, and a credits line)

**Interfaces:**
- Consumes: the deployed server (Task 10) and the route (Task 7).

- [ ] **Step 1: Update `README.md`**

- Add to the privacy list (after the notes line): `- Each line the app speaks is sent through OnBeat's server to the voice service on Modal, which makes the audio. It isn't stored or logged.`
- Line 5: `(... the speech models download to your browser the first time).`
- Line 27: replace "Each voice downloads a small file the first time it's used." with "There are 13 voices in American, Canadian and British accents."
- Line 46: replace "Kokoro for text-to-speech" with "Chatterbox on Modal for text-to-speech, with Kokoro in the browser as the backup voice".
- Line 56: replace "The first visit downloads the voice (about 90 MB)" with "The first visit downloads the backup voice (about 90 MB)".
- Add a short "Voices" paragraph: the voices are made by Chatterbox (Resemble AI, MIT) from recordings in the CSTR VCTK Corpus (University of Edinburgh, CC BY 4.0), with a link to `voice-server/refs/README.md`.

Commit:

```bash
git add README.md
git commit -m "README: Chatterbox voices, the voice service in the privacy notes, VCTK credit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Full local checks**

Run: `npm run typecheck && npm run lint && npx vitest run`, then the e2e suites one at a time: `npx playwright test`.
Expected: all pass (the 2 live-model tests stay skipped as before).

- [ ] **Step 3: Owner steps (Claude gives these, the owner does them)**

1. In Modal's dashboard: Settings, Usage & Billing, spend limit $0 (if not done).
2. In Modal's dashboard: Settings, Proxy Auth Tokens, New token. Keep the page open.
3. In Vercel: Project `onbeat`, Settings, Environment Variables. Add `MODAL_SPEAK_URL` (the URL from Task 10), `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` (from step 2) for Production and Preview.
4. Push the branch and open a PR (Claude does this): `git push -u origin feat/chatterbox-voices`, then `gh pr create`.

- [ ] **Step 4: Preview check (Claude)**

On the PR's Vercel preview (with the bypass token if protection is on): open a profile; the status line goes from "Waking your voice…" to "Your voice is ready." Play a sample, type a line and tap a reply; each plays within about 2 s with no backup notice. Then stop the voice server with `PYTHONUTF8=1 python -m modal app stop onbeat-voice` (ask the owner first, it takes the voice down), type a line, and check the backup notice and "Using the backup voice." appear and the line is spoken. Redeploy with Task 10 Step 4's command and confirm the status returns to "Your voice is ready." within about a minute.

- [ ] **Step 5: Owner listens**

Point the owner to `C:/Users/hujai/Music/chatterbox-test/deployed` (from Task 10's check): one file per voice and speed. Ask them to confirm each voice matches what they picked, and that Slower and Faster sound right. Record their answer in the PR description.

- [ ] **Step 6: Update `.superpowers/progress.md`** in the main checkout with the PR number, the deployed URL, the check numbers (timings, cold start, cost) and what's left for the owner (merge).
