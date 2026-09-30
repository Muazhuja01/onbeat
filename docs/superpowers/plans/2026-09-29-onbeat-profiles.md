# OnBeat profiles (stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a real person set up their own profile (name, about-me, people, places, notes from a document), keep several profiles in the browser, switch, edit, export and import them, with the example people behind a demo link.

**Architecture:** A `ProfileRegistry` over the existing idb-keyval store keeps the profile list and one snapshot per profile; each open profile gets its own `MemoryStore` (unchanged). New components (setup, notes editor, document import, profile menu, demo bar) are wired into `ConversationScreen` through a small view state. A new server route turns an uploaded document into draft notes with the existing providers; the user confirms each one.

**Tech Stack:** Next 16 (app router), React 19, TypeScript, Tailwind, idb-keyval, zod 4, Vitest + Testing Library, Playwright. New: `mammoth` (docx), `unpdf` (pdf); `jszip` (dev, test fixtures).

**Spec:** `docs/superpowers/specs/2026-09-29-onbeat-profiles-design.md`

## Global Constraints

- Notes are at most 300 characters (`NOTE_MAX = 300`); the reply prompt cuts at 300.
- Profile names: trimmed, 1 to 40 characters.
- Documents: .txt, .md, .docx, .pdf; at most 4 MB; first 20,000 characters used; at most 40 draft notes.
- Document route: same-origin check, 5 requests a minute per IP, content never logged.
- Storage: IndexedDB database `onbeat`, store `memory`; keys `profiles`, `profile:<id>`; old key `snapshot` is deleted.
- Demo profiles are never saved and never listed.
- Copy speaks to the user ("you"). Plain words, no emoji. Targets at least 48 px (`min-h-12`), existing focus rings, all four themes, no sideways scroll at 320 px.
- Before writing Next code, read the relevant guide in `node_modules/next/dist/docs/` (AGENTS.md).

## Review Focus

1. A profile name that is only spaces, or very long: setup must refuse blank and cut at 40 (tested in Task 2 and Task 7).
2. Importing the same export twice: two separate profiles, no shared ids, second named "Name (2)" (Task 4).
3. A scanned PDF or empty document: a plain "no text found" message, nothing saved (Task 5 and Task 6).
4. Deleting the active profile when it is the only one: back to setup, no stale notes on screen (Task 9 e2e).
5. A request in flight when switching profiles: its replies must not appear for the new profile (`client.cancel()` before switching; Task 9, checked by the e2e switch test seeing no old replies).

---

## File map

- Create `src/lib/profiles/kv.ts`: key-value interface, in-memory and IndexedDB versions.
- Create `src/lib/profiles/registry.ts`: `ProfileRegistry`, `openBrowserRegistry()`.
- Create `src/lib/profiles/notes.ts`: `NOTE_MAX`, `guessEntities`, `buildNote`, `noteFields`, `aboutMeText`, `DraftNote`.
- Create `src/lib/profiles/transfer.ts`: export and import.
- Create `src/lib/profiles/document-notes.ts`: prompt and parser for document notes (shared by server and tests).
- Create `src/lib/profiles/document-client.ts`: browser call to the route with error messages.
- Create `src/lib/server/document-text.ts`: text from txt, md, docx, pdf.
- Create `src/app/api/notes-from-document/route.ts`.
- Modify `src/lib/server/providers.ts`: `maxTokens` and `temperature` options.
- Create components `note-form.tsx`, `notes-editor.tsx`, `document-import.tsx`, `profile-setup.tsx`, `profile-menu.tsx`, `demo-bar.tsx`.
- Modify `src/components/profile-picker.tsx` (demo picker), `src/components/conversation-screen.tsx`, `src/lib/memory/browser.ts`.
- Delete `src/lib/memory/idb-persist.ts` and its test (replaced by the registry).
- Modify `tests/e2e/helpers.ts`, `tests/e2e/conversation.spec.ts`; create `tests/e2e/profiles.spec.ts`.
- Modify `README.md` (what the app does now).

---

### Task 1: Key-value store and profile registry

**Files:**
- Create: `src/lib/profiles/kv.ts`, `src/lib/profiles/registry.ts`
- Test: `src/lib/profiles/registry.test.ts`

**Interfaces:**
- Produces:
  - `interface KeyValue { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void>; del(key: string): Promise<void> }`
  - `memoryKeyValue(): KeyValue`, `idbKeyValue(): KeyValue`
  - `interface ProfileInfo { id: string; name: string; createdAt: number }`
  - `class ProfileRegistry { static open(kv, opts?: { durable?: boolean; now?: () => number }): Promise<ProfileRegistry>; readonly durable: boolean; list(): ProfileInfo[]; active(): ProfileInfo | null; create(name: string): Promise<ProfileInfo>; rename(id: string, name: string): Promise<void>; remove(id: string): Promise<void>; setActive(id: string): Promise<void>; persistFor(id: string): Persist; uniqueName(name: string): string }`
  - `cleanName(name: string): string` (trim, collapse spaces, cut at 40)
  - `openBrowserRegistry(): Promise<ProfileRegistry>`

- [ ] **Step 1: Write the failing test** (`src/lib/profiles/registry.test.ts`)

```ts
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { idbKeyValue, memoryKeyValue } from "./kv";
import { cleanName, openBrowserRegistry, ProfileRegistry } from "./registry";

describe("ProfileRegistry", () => {
  it("starts empty and creates an active profile", async () => {
    const reg = await ProfileRegistry.open(memoryKeyValue(), { now: () => 5 });
    expect(reg.list()).toEqual([]);
    expect(reg.active()).toBeNull();
    const p = await reg.create("  Maya   Lopez ");
    expect(p).toMatchObject({ name: "Maya Lopez", createdAt: 5 });
    expect(reg.active()?.id).toBe(p.id);
  });

  it("refuses a blank name and cuts long ones", async () => {
    const reg = await ProfileRegistry.open(memoryKeyValue());
    await expect(reg.create("   ")).rejects.toThrow();
    expect(cleanName("x".repeat(60))).toHaveLength(40);
  });

  it("keeps each profile's notes apart and survives reopening", async () => {
    const kv = memoryKeyValue();
    const reg = await ProfileRegistry.open(kv);
    const a = await reg.create("A");
    const b = await reg.create("B");
    await reg.persistFor(a.id).save({ version: 1, notes: [], phrases: [{ id: "p", text: "Hi", context: { timeOfDay: "morning" }, timesUsed: 1, lastUsed: 1 }] });
    expect(await reg.persistFor(b.id).load()).toBeNull();
    const again = await ProfileRegistry.open(kv);
    expect(again.list().map((p) => p.name)).toEqual(["A", "B"]);
    expect(again.active()?.id).toBe(b.id);
    expect((await again.persistFor(a.id).load())?.phrases[0]?.text).toBe("Hi");
  });

  it("switches, renames and removes", async () => {
    const kv = memoryKeyValue();
    const reg = await ProfileRegistry.open(kv);
    const a = await reg.create("A");
    const b = await reg.create("B");
    await reg.setActive(a.id);
    await reg.rename(a.id, "Anna");
    expect(reg.active()?.name).toBe("Anna");
    await reg.persistFor(a.id).save({ version: 1, notes: [], phrases: [] });
    await reg.remove(a.id);
    expect(reg.list().map((p) => p.id)).toEqual([b.id]);
    expect(reg.active()?.id).toBe(b.id);
    expect(await kv.get(`profile:${a.id}`)).toBeUndefined();
    await reg.remove(b.id);
    expect(reg.active()).toBeNull();
  });

  it("gives a clashing name a number", async () => {
    const reg = await ProfileRegistry.open(memoryKeyValue());
    await reg.create("Maya");
    expect(reg.uniqueName("Maya")).toBe("Maya (2)");
    await reg.create("Maya (2)");
    expect(reg.uniqueName("maya")).toBe("maya (3)");
    expect(reg.uniqueName("Tom")).toBe("Tom");
  });

  it("drops the old single snapshot", async () => {
    const kv = memoryKeyValue();
    await kv.set("snapshot", { version: 1, notes: [], phrases: [] });
    const reg = await ProfileRegistry.open(kv);
    expect(reg.list()).toEqual([]);
    expect(await kv.get("snapshot")).toBeUndefined();
  });

  it("works on IndexedDB and reports durable storage", async () => {
    const reg = await openBrowserRegistry();
    expect(reg.durable).toBe(true);
    await reg.create("Idb");
    const again = await ProfileRegistry.open(idbKeyValue());
    expect(again.list().some((p) => p.name === "Idb")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/lib/profiles/registry.test.ts`
Expected: FAIL, cannot resolve `./kv`.

- [ ] **Step 3: Implement**

`src/lib/profiles/kv.ts`:

```ts
import { createStore, del, get, set } from "idb-keyval";

/** The few storage calls profiles need, so tests can run on a plain map. */
export interface KeyValue {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

export function memoryKeyValue(): KeyValue {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return map.has(key) ? (structuredClone(map.get(key)) as T) : undefined;
    },
    async set(key, value) {
      map.set(key, structuredClone(value));
    },
    async del(key) {
      map.delete(key);
    },
  };
}

/** The database and store OnBeat has always used; a new store would need a version change. */
export function idbKeyValue(): KeyValue {
  const store = createStore("onbeat", "memory");
  return {
    get: <T,>(key: string) => get<T>(key, store),
    set: (key, value) => set(key, value, store),
    del: (key) => del(key, store),
  };
}
```

`src/lib/profiles/registry.ts`:

```ts
import type { Persist, Snapshot } from "@/lib/memory/persist";
import { idbKeyValue, memoryKeyValue, type KeyValue } from "./kv";

export interface ProfileInfo {
  id: string;
  name: string;
  createdAt: number;
}

interface RegistryState {
  version: 1;
  activeId: string | null;
  profiles: ProfileInfo[];
}

const LIST_KEY = "profiles";
/** Before profiles, one snapshot held everything, and it only ever came from the example people. */
const OLD_KEY = "snapshot";
export const NAME_MAX = 40;

export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, NAME_MAX).trim();
}

export class ProfileRegistry {
  private constructor(
    private readonly kv: KeyValue,
    private state: RegistryState,
    readonly durable: boolean,
    private readonly now: () => number,
  ) {}

  static async open(kv: KeyValue, opts: { durable?: boolean; now?: () => number } = {}): Promise<ProfileRegistry> {
    const state = (await kv.get<RegistryState>(LIST_KEY)) ?? { version: 1, activeId: null, profiles: [] };
    await kv.del(OLD_KEY);
    return new ProfileRegistry(kv, state, opts.durable ?? true, opts.now ?? Date.now);
  }

  list(): ProfileInfo[] {
    return [...this.state.profiles];
  }

  active(): ProfileInfo | null {
    return this.state.profiles.find((p) => p.id === this.state.activeId) ?? null;
  }

  async create(name: string): Promise<ProfileInfo> {
    const clean = cleanName(name);
    if (!clean) throw new Error("A profile needs a name");
    const profile = { id: crypto.randomUUID(), name: clean, createdAt: this.now() };
    await this.write({ ...this.state, activeId: profile.id, profiles: [...this.state.profiles, profile] });
    return profile;
  }

  async rename(id: string, name: string): Promise<void> {
    const clean = cleanName(name);
    if (!clean) throw new Error("A profile needs a name");
    await this.write({ ...this.state, profiles: this.state.profiles.map((p) => (p.id === id ? { ...p, name: clean } : p)) });
  }

  async remove(id: string): Promise<void> {
    const profiles = this.state.profiles.filter((p) => p.id !== id);
    const activeId = this.state.activeId === id ? (profiles[0]?.id ?? null) : this.state.activeId;
    await this.kv.del(`profile:${id}`);
    await this.write({ ...this.state, activeId, profiles });
  }

  async setActive(id: string): Promise<void> {
    if (!this.state.profiles.some((p) => p.id === id)) return;
    await this.write({ ...this.state, activeId: id });
  }

  persistFor(id: string): Persist {
    const key = `profile:${id}`;
    return {
      durable: this.durable,
      load: async () => (await this.kv.get<Snapshot>(key)) ?? null,
      save: (snapshot) => this.kv.set(key, snapshot),
    };
  }

  uniqueName(name: string): string {
    const clean = cleanName(name) || "Profile";
    const taken = new Set(this.state.profiles.map((p) => p.name.toLowerCase()));
    if (!taken.has(clean.toLowerCase())) return clean;
    for (let n = 2; ; n++) {
      const candidate = `${clean} (${n})`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  private async write(state: RegistryState): Promise<void> {
    await this.kv.set(LIST_KEY, state);
    this.state = state;
  }
}

/** IndexedDB when it works (not in some private windows), otherwise memory for this visit. */
export async function openBrowserRegistry(): Promise<ProfileRegistry> {
  try {
    return await ProfileRegistry.open(idbKeyValue());
  } catch {
    return ProfileRegistry.open(memoryKeyValue(), { durable: false });
  }
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run src/lib/profiles/registry.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/profiles
git commit -m "Add a profile registry with one saved snapshot per profile"
```

---

### Task 2: Note helpers

**Files:**
- Create: `src/lib/profiles/notes.ts`
- Test: `src/lib/profiles/notes.test.ts`

**Interfaces:**
- Consumes: `COMMON_WORDS` from `@/lib/suggest/common-words`, `Note`, `NoteKind` from `@/lib/types`.
- Produces:
  - `NOTE_MAX = 300`
  - `interface DraftNote { kind: NoteKind; name?: string; text: string }`
  - `hasName(kind: NoteKind): boolean` (person, place)
  - `guessEntities(text: string): string[]`
  - `buildNote(draft: DraftNote, opts: { id?: string; pinned?: boolean; now: number }): Note`
  - `noteFields(note: Note): { name: string; text: string }` (inverse of buildNote for editing)
  - `aboutMeText(name: string, text: string): string`
  - `setupNotes(input: { name: string; about: string; drafts: DraftNote[] }, now: number): Note[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { aboutMeText, buildNote, guessEntities, noteFields, NOTE_MAX, setupNotes } from "./notes";

describe("guessEntities", () => {
  it("finds names, joined when they run together, and skips ordinary words", () => {
    expect(guessEntities("My usual order at Blue Door Café is a latte. Leila is my daughter.")).toEqual(["Blue Door Café", "Leila"]);
    expect(guessEntities("I have physio on Tuesdays. The bus is slow.")).toEqual(["Tuesdays"]);
    expect(guessEntities("i like tea")).toEqual([]);
  });
});

describe("buildNote and noteFields", () => {
  it("puts a person's name first and reads it back", () => {
    const note = buildNote({ kind: "person", name: "Sam", text: "the barista at Blue Door Café" }, { now: 7, id: "n1" });
    expect(note).toMatchObject({ id: "n1", kind: "person", text: "Sam: the barista at Blue Door Café", updatedAt: 7 });
    expect(note.entities).toEqual(["Sam", "Blue Door Café"]);
    expect(noteFields(note)).toEqual({ name: "Sam", text: "the barista at Blue Door Café" });
  });

  it("keeps a description that already names the person as it is", () => {
    const note = buildNote({ kind: "person", name: "Sam", text: "Sam is the barista." }, { now: 1 });
    expect(note.text).toBe("Sam is the barista.");
    expect(noteFields(note)).toEqual({ name: "Sam", text: "Sam is the barista." });
  });

  it("cuts text to the note limit and trims it", () => {
    const note = buildNote({ kind: "routine", text: `  ${"a".repeat(400)}  ` }, { now: 1 });
    expect(note.text).toHaveLength(NOTE_MAX);
    expect(note.id).toMatch(/^n_/);
  });
});

describe("aboutMeText", () => {
  it("adds the name when the text doesn't mention it", () => {
    expect(aboutMeText("Maya", "I have ALS and type to talk.")).toBe("I'm Maya. I have ALS and type to talk.");
    expect(aboutMeText("Maya", "I'm Maya, I type to talk.")).toBe("I'm Maya, I type to talk.");
    expect(aboutMeText("Maya", "  ")).toBe("I'm Maya.");
  });
});

describe("setupNotes", () => {
  it("makes one pinned about-me note first, then the drafts unpinned", () => {
    const notes = setupNotes(
      { name: "Maya", about: "I type to talk.", drafts: [{ kind: "about-me", text: "I love mystery novels." }, { kind: "place", name: "Home", text: "my flat" }] },
      3,
    );
    expect(notes.map((n) => [n.kind, n.pinned ?? false])).toEqual([["about-me", true], ["about-me", false], ["place", false]]);
    expect(notes[0].text).toBe("I'm Maya. I type to talk.");
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/lib/profiles/notes.test.ts` — Expected: FAIL, cannot resolve `./notes`.

- [ ] **Step 3: Implement** `src/lib/profiles/notes.ts`

```ts
import { COMMON_WORDS } from "@/lib/suggest/common-words";
import type { Note, NoteKind } from "@/lib/types";

/** The reply prompt cuts each note at 300 characters (src/lib/suggest/request.ts). */
export const NOTE_MAX = 300;

/** A note as the user writes it, before it gets an id and search names. */
export interface DraftNote {
  kind: NoteKind;
  name?: string;
  text: string;
}

export const hasName = (kind: NoteKind) => kind === "person" || kind === "place";

const WORD = /[\p{L}\p{N}'’-]+/gu;

/**
 * Proper names in a note, for search: runs of capitalised words that aren't
 * everyday words ("Blue Door Café", "Leila"). Never shown to the user.
 */
export function guessEntities(text: string): string[] {
  const found: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    let run: string[] = [];
    const flush = () => {
      if (run.length) found.push(run.join(" "));
      run = [];
    };
    for (const [word] of sentence.matchAll(WORD)) {
      const capital = /^\p{Lu}/u.test(word);
      const ordinary = COMMON_WORDS.has(word.toLowerCase()) || word === "I";
      if (capital && (!ordinary || run.length > 0)) run.push(word);
      else flush();
    }
    flush();
  }
  return [...new Set(found)];
}

function clip(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, NOTE_MAX).trim();
}

export function buildNote(draft: DraftNote, opts: { id?: string; pinned?: boolean; now: number }): Note {
  const name = hasName(draft.kind) ? (draft.name ?? "").trim() : "";
  const body = draft.text.trim();
  const mentions = name && body.toLowerCase().includes(name.toLowerCase());
  const text = clip(name && !mentions ? `${name}: ${body}` : body || name);
  const entities = [...new Set([...(name ? [name] : []), ...guessEntities(text)])];
  return {
    id: opts.id ?? `n_${crypto.randomUUID()}`,
    kind: draft.kind,
    text,
    entities,
    updatedAt: opts.now,
    ...(opts.pinned ? { pinned: true } : {}),
  };
}

/** The fields the note form shows for an existing note. */
export function noteFields(note: Note): { name: string; text: string } {
  if (!hasName(note.kind)) return { name: "", text: note.text };
  const name = note.entities[0] ?? "";
  const prefix = `${name}: `;
  return { name, text: name && note.text.startsWith(prefix) ? note.text.slice(prefix.length) : note.text };
}

/** Replies speak for the user, so the main note says who they are. */
export function aboutMeText(name: string, text: string): string {
  const body = text.trim();
  if (!body) return `I'm ${name}.`;
  return body.toLowerCase().includes(name.toLowerCase()) ? body : `I'm ${name}. ${body}`;
}

export function setupNotes(input: { name: string; about: string; drafts: DraftNote[] }, now: number): Note[] {
  const main = buildNote({ kind: "about-me", text: aboutMeText(input.name, input.about) }, { now, pinned: true });
  return [main, ...input.drafts.map((d) => buildNote(d, { now }))];
}
```

- [ ] **Step 4: Run it and see it pass** — `npx vitest run src/lib/profiles/notes.test.ts`. If `guessEntities` fails on "Tuesdays" or "Blue Door Café" because a word is in `COMMON_WORDS`, check the list and adjust the test to the list's actual contents, never add names to the list.

- [ ] **Step 5: Commit** — `git add src/lib/profiles/notes* && git commit -m "Add note helpers for typed notes"`

---

### Task 3: Export and import

**Files:**
- Create: `src/lib/profiles/transfer.ts`
- Test: `src/lib/profiles/transfer.test.ts`

**Interfaces:**
- Consumes: `Note`, `Phrase` from `@/lib/types`; zod.
- Produces:
  - `exportProfile(name: string, notes: Note[], phrases: Phrase[], now: Date): string` (JSON text)
  - `exportFileName(name: string, now: Date): string` → `onbeat-maya-2026-09-29.json`
  - `parseImport(text: string): { name: string; notes: Note[]; phrases: Phrase[] } | null` (new ids, phrase contexts remapped)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { exportFileName, exportProfile, parseImport } from "./transfer";
import type { Note, Phrase } from "@/lib/types";

const notes: Note[] = [
  { id: "cafe", kind: "place", text: "Blue Door Café: my café", entities: ["Blue Door Café"], updatedAt: 1 },
  { id: "me", kind: "about-me", text: "I'm Maya.", entities: ["Maya"], updatedAt: 1, pinned: true },
];
const phrases: Phrase[] = [{ id: "p1", text: "My usual.", context: { placeId: "cafe", timeOfDay: "morning" }, timesUsed: 3, lastUsed: 9 }];
const now = new Date("2026-09-29T20:00:00Z");

describe("export and import", () => {
  it("round-trips with fresh ids and remapped phrase places", () => {
    const back = parseImport(exportProfile("Maya", notes, phrases, now));
    expect(back?.name).toBe("Maya");
    expect(back?.notes.map((n) => n.text)).toEqual(notes.map((n) => n.text));
    expect(back?.notes[1].pinned).toBe(true);
    const cafe = back!.notes[0];
    expect(cafe.id).not.toBe("cafe");
    expect(back?.phrases[0].context.placeId).toBe(cafe.id);
    expect(back?.phrases[0].id).not.toBe("p1");
  });

  it("gives two imports of one file different ids", () => {
    const text = exportProfile("Maya", notes, phrases, now);
    expect(parseImport(text)!.notes[0].id).not.toBe(parseImport(text)!.notes[0].id);
  });

  it("refuses anything that isn't an OnBeat export", () => {
    expect(parseImport("not json")).toBeNull();
    expect(parseImport(JSON.stringify({ format: "other" }))).toBeNull();
    expect(parseImport(JSON.stringify({ format: "onbeat-profile", version: 1, profile: { name: "" }, notes: [], phrases: [] }))).toBeNull();
    const bad = JSON.parse(exportProfile("Maya", notes, phrases, now));
    bad.notes[0].kind = "secret";
    expect(parseImport(JSON.stringify(bad))).toBeNull();
  });

  it("drops a phrase context that points at a note that isn't there", () => {
    const text = exportProfile("Maya", [], phrases, now);
    expect(parseImport(text)?.phrases[0].context.placeId).toBeUndefined();
  });

  it("names the file after the profile and date", () => {
    expect(exportFileName("Maya López", now)).toBe("onbeat-maya-lopez-2026-09-29.json");
    expect(exportFileName("!!!", now)).toBe("onbeat-profile-2026-09-29.json");
  });
});
```

- [ ] **Step 2: Run and see it fail** — `npx vitest run src/lib/profiles/transfer.test.ts`.

- [ ] **Step 3: Implement** `src/lib/profiles/transfer.ts`

```ts
import { z } from "zod";
import type { Note, Phrase } from "@/lib/types";
import { cleanName } from "./registry";

const NoteSchema = z.object({
  id: z.string(),
  kind: z.enum(["person", "place", "routine", "preference", "about-me"]),
  text: z.string().max(2000),
  entities: z.array(z.string().max(200)).max(50),
  updatedAt: z.number(),
  pinned: z.boolean().optional(),
});

const PhraseSchema = z.object({
  id: z.string(),
  text: z.string().max(2000),
  context: z.object({
    placeId: z.string().optional(),
    partnerId: z.string().optional(),
    timeOfDay: z.enum(["morning", "afternoon", "evening", "night"]),
  }),
  timesUsed: z.number(),
  lastUsed: z.number(),
});

const ExportSchema = z.object({
  format: z.literal("onbeat-profile"),
  version: z.literal(1),
  exportedAt: z.string(),
  profile: z.object({ name: z.string() }),
  notes: z.array(NoteSchema).max(5000),
  phrases: z.array(PhraseSchema).max(20000),
});

export function exportProfile(name: string, notes: Note[], phrases: Phrase[], now: Date): string {
  return JSON.stringify({ format: "onbeat-profile", version: 1, exportedAt: now.toISOString(), profile: { name }, notes, phrases }, null, 2);
}

export function exportFileName(name: string, now: Date): string {
  const slug =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "profile";
  return `onbeat-${slug}-${now.toISOString().slice(0, 10)}.json`;
}

/** Reads an export. Ids are made new so importing one file twice never mixes two profiles. */
export function parseImport(text: string): { name: string; notes: Note[]; phrases: Phrase[] } | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = ExportSchema.safeParse(data);
  if (!parsed.success) return null;
  const name = cleanName(parsed.data.profile.name);
  if (!name) return null;

  const ids = new Map(parsed.data.notes.map((n) => [n.id, `n_${crypto.randomUUID()}`]));
  const notes: Note[] = parsed.data.notes.map((n) => ({ ...n, id: ids.get(n.id)! }));
  const phrases: Phrase[] = parsed.data.phrases.map((p) => ({
    ...p,
    id: `p_${crypto.randomUUID()}`,
    context: {
      timeOfDay: p.context.timeOfDay,
      placeId: p.context.placeId ? ids.get(p.context.placeId) : undefined,
      partnerId: p.context.partnerId ? ids.get(p.context.partnerId) : undefined,
    },
  }));
  return { name, notes, phrases };
}
```

- [ ] **Step 4: Run and see it pass.**
- [ ] **Step 5: Commit** — `git commit -m "Add profile export and import"`

---

### Task 4: Document text and document notes (server)

**Files:**
- Modify: `src/lib/server/providers.ts` (StreamOptions gets `maxTokens?: number; temperature?: number`, used in the request body in place of 400 and 0.6)
- Create: `src/lib/server/document-text.ts`, `src/lib/profiles/document-notes.ts`, `src/app/api/notes-from-document/route.ts`
- Test: `src/lib/server/document-text.test.ts`, `src/lib/profiles/document-notes.test.ts`, `src/app/api/notes-from-document/route.test.ts`
- `npm install mammoth unpdf` and `npm install -D jszip`

**Interfaces:**
- Produces:
  - `DOCUMENT_MAX_BYTES = 4 * 1024 * 1024`, `DOCUMENT_MAX_CHARS = 20_000`
  - `documentKind(name: string): "text" | "docx" | "pdf" | null`
  - `extractDocumentText(name: string, bytes: Uint8Array): Promise<string>` (throws on unsupported)
  - `buildDocumentMessages(text: string): ChatMessage[]`
  - `parseDocumentNotes(output: string): DraftNote[]` (max 40)
  - Route response: `200 { notes: DraftNote[]; truncated: boolean }`; errors `{ error: "forbidden" | "rate_limited" | "too_large" | "unsupported" | "no_text" | "invalid_request" | "unavailable" }` with 403, 429, 413, 415, 422, 400, 503.

- [ ] **Step 1: Install**: `npm install mammoth unpdf && npm install -D jszip`. Check the Next docs on route handlers and `serverExternalPackages` (`node_modules/next/dist/docs/`); if the build later fails to bundle `unpdf` or `mammoth`, add them to `serverExternalPackages` in `next.config.ts`.

- [ ] **Step 2: Failing tests**

`src/lib/server/document-text.test.ts`:

```ts
// @vitest-environment node
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { documentKind, extractDocumentText } from "./document-text";

async function docx(text: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "uint8array" });
}

/** A one-page PDF with correct byte offsets. */
function pdf(text: string): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${`BT /F1 18 Tf 20 60 Td (${text}) Tj ET`.length} >>\nstream\nBT /F1 18 Tf 20 60 Td (${text}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

describe("extractDocumentText", () => {
  it("knows the supported types by extension", () => {
    expect(documentKind("me.TXT")).toBe("text");
    expect(documentKind("me.md")).toBe("text");
    expect(documentKind("me.docx")).toBe("docx");
    expect(documentKind("me.pdf")).toBe("pdf");
    expect(documentKind("me.doc")).toBeNull();
  });

  it("reads plain text, Word and PDF", async () => {
    expect(await extractDocumentText("a.txt", new TextEncoder().encode("I'm Maya.\r\n"))).toBe("I'm Maya.");
    expect(await extractDocumentText("a.docx", await docx("Sam is my barista."))).toBe("Sam is my barista.");
    expect(await extractDocumentText("a.pdf", pdf("I have physio on Tuesdays."))).toContain("I have physio on Tuesdays.");
  });

  it("refuses other types", async () => {
    await expect(extractDocumentText("a.exe", new Uint8Array())).rejects.toThrow("unsupported");
  });
});
```

`src/lib/profiles/document-notes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildDocumentMessages, parseDocumentNotes } from "./document-notes";

describe("document notes", () => {
  it("puts the document inside the prompt", () => {
    const msgs = buildDocumentMessages("I'm Maya.");
    expect(msgs.at(-1)?.content).toContain("I'm Maya.");
  });

  it("keeps valid lines, fixes kinds and drops the rest", () => {
    const out = [
      '{"kind": "about-me", "text": "I have ALS."}',
      "not json",
      '{"kind": "person", "name": "Sam", "text": "Sam is my barista."}',
      '{"kind": "secret", "text": "x"}',
      '{"kind": "routine", "text": ""}',
      '```',
      '  {"kind": "place", "name": "Home", "text": "' + "a".repeat(400) + '"}',
    ].join("\n");
    const notes = parseDocumentNotes(out);
    expect(notes.map((n) => n.kind)).toEqual(["about-me", "person", "place"]);
    expect(notes[1]).toEqual({ kind: "person", name: "Sam", text: "Sam is my barista." });
    expect(notes[2].text.length).toBeLessThanOrEqual(300);
  });

  it("stops at 40 notes", () => {
    const out = Array.from({ length: 50 }, (_, i) => `{"kind": "preference", "text": "Fact ${i}"}`).join("\n");
    expect(parseDocumentNotes(out)).toHaveLength(40);
  });
});
```

`src/app/api/notes-from-document/route.test.ts` (mock providers):

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const streamCompletion = vi.fn();
vi.mock("@/lib/server/providers", async (orig) => ({ ...(await orig<typeof import("@/lib/server/providers")>()), streamCompletion }));

async function* lines(text: string) {
  yield text;
}

function post(file: File | null, headers: Record<string, string> = {}) {
  const form = new FormData();
  if (file) form.append("file", file);
  return new Request("http://localhost/api/notes-from-document", { method: "POST", body: form, headers: { host: "localhost", origin: "http://localhost", "x-forwarded-for": `ip-${Math.random()}`, ...headers } });
}

describe("POST /api/notes-from-document", () => {
  beforeEach(() => streamCompletion.mockReset());

  it("returns draft notes from a text file", async () => {
    streamCompletion.mockResolvedValue({ provider: "groq", deltas: lines('{"kind": "about-me", "text": "I type to talk."}\n') });
    const { POST } = await import("./route");
    const res = await POST(post(new File(["I'm Maya and I type to talk."], "me.txt")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notes: [{ kind: "about-me", text: "I type to talk." }], truncated: false });
  });

  it("refuses other sites, big files, other types and empty text", async () => {
    const { POST } = await import("./route");
    expect((await POST(post(new File(["x"], "a.txt"), { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(post(new File([new Uint8Array(4 * 1024 * 1024 + 1)], "a.txt")))).status).toBe(413);
    expect((await POST(post(new File(["x"], "a.exe")))).status).toBe(415);
    expect((await POST(post(new File(["   "], "a.txt")))).status).toBe(422);
    expect((await POST(post(null))).status).toBe(400);
  });

  it("cuts long documents and says so", async () => {
    streamCompletion.mockResolvedValue({ provider: "groq", deltas: lines("") });
    const { POST } = await import("./route");
    const res = await POST(post(new File(["a ".repeat(15_000)], "long.txt")));
    expect((await res.json()).truncated).toBe(true);
    const sent = streamCompletion.mock.calls[0][0].at(-1).content as string;
    expect(sent.length).toBeLessThan(22_000);
  });

  it("says when the AI is unavailable", async () => {
    const { AllProvidersFailedError } = await import("@/lib/server/providers");
    streamCompletion.mockRejectedValue(new AllProvidersFailedError("down"));
    const { POST } = await import("./route");
    expect((await POST(post(new File(["I'm Maya."], "a.txt")))).status).toBe(503);
  });
});
```

- [ ] **Step 3: Run and see them fail** — `npx vitest run src/lib/server/document-text.test.ts src/lib/profiles/document-notes.test.ts src/app/api/notes-from-document`.

- [ ] **Step 4: Implement**

`src/lib/server/providers.ts`: add to `StreamOptions`

```ts
  /** Longest answer allowed; replies need about 400 tokens. */
  maxTokens?: number;
  temperature?: number;
```

and in the request body use `temperature: opts.temperature ?? 0.6, max_tokens: opts.maxTokens ?? 400,`.

`src/lib/server/document-text.ts`:

```ts
export const DOCUMENT_MAX_BYTES = 4 * 1024 * 1024;
export const DOCUMENT_MAX_CHARS = 20_000;

export function documentKind(name: string): "text" | "docx" | "pdf" | null {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "txt" || ext === "md") return "text";
  if (ext === "docx") return "docx";
  if (ext === "pdf") return "pdf";
  return null;
}

function tidy(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function extractDocumentText(name: string, bytes: Uint8Array): Promise<string> {
  switch (documentKind(name)) {
    case "text":
      return tidy(new TextDecoder("utf-8").decode(bytes));
    case "docx": {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return tidy(value);
    }
    case "pdf": {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const doc = await getDocumentProxy(bytes);
      const { text } = await extractText(doc, { mergePages: true });
      return tidy(text);
    }
    default:
      throw new Error("unsupported");
  }
}
```

`src/lib/profiles/document-notes.ts`:

```ts
import type { ChatMessage } from "@/lib/suggest/prompt";
import type { NoteKind } from "@/lib/types";
import { NOTE_MAX, type DraftNote } from "./notes";

export const DOCUMENT_NOTES_MAX = 40;
const KINDS: NoteKind[] = ["about-me", "person", "place", "routine", "preference"];

export function buildDocumentMessages(text: string): ChatMessage[] {
  const prompt = [
    "A person who cannot speak uses an app that suggests replies for them in conversations. They have shared a document about themselves. Turn it into short notes the app can use.",
    "",
    "Rules:",
    "- One fact per note, written in first person as the person (\"My daughter Leila studies in Toronto.\").",
    `- At most ${NOTE_MAX} characters per note. Plain words.`,
    "- Only facts the document states. Never guess or add anything.",
    "- kind is one of: about-me (who they are, health, how they communicate), person (someone in their life; give their name), place (somewhere they go; give its name), routine (regular events and times), preference (likes, dislikes, usual orders).",
    "- Leave out other people's private details that aren't needed to talk with them.",
    `- At most ${DOCUMENT_NOTES_MAX} notes, most useful first.`,
    "",
    "Output format: one JSON object per line and nothing else. No markdown.",
    '{"kind": "person", "name": "Leila", "text": "Leila is my daughter. She studies in Toronto."}',
    '{"kind": "routine", "text": "I have physio on Tuesdays at 10:30."}',
    "",
    "The document:",
    '"""',
    text,
    '"""',
  ].join("\n");
  return [
    { role: "system", content: "You turn documents into short first-person notes. Follow the output format exactly." },
    { role: "user", content: prompt },
  ];
}

export function parseDocumentNotes(output: string): DraftNote[] {
  const notes: DraftNote[] = [];
  for (const line of output.split("\n")) {
    if (notes.length >= DOCUMENT_NOTES_MAX) break;
    const start = line.indexOf("{");
    const end = line.lastIndexOf("}");
    if (start < 0 || end < start) continue;
    let item: unknown;
    try {
      item = JSON.parse(line.slice(start, end + 1));
    } catch {
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const { kind, name, text } = item as Record<string, unknown>;
    if (!KINDS.includes(kind as NoteKind) || typeof text !== "string" || !text.trim()) continue;
    const note: DraftNote = { kind: kind as NoteKind, text: text.trim().slice(0, NOTE_MAX) };
    if ((kind === "person" || kind === "place") && typeof name === "string" && name.trim()) note.name = name.trim().slice(0, 60);
    notes.push(note);
  }
  return notes;
}
```

`src/app/api/notes-from-document/route.ts`:

```ts
import { buildDocumentMessages, parseDocumentNotes } from "@/lib/profiles/document-notes";
import { DOCUMENT_MAX_BYTES, DOCUMENT_MAX_CHARS, documentKind, extractDocumentText } from "@/lib/server/document-text";
import { AllProvidersFailedError, createCooldown, providerConfigs, streamCompletion } from "@/lib/server/providers";
import { createRateLimiter } from "@/lib/server/rate-limit";

const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
const cooldown = createCooldown();

function json(data: unknown, status: number): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

/** Turns an uploaded document into draft notes. The user confirms each one; nothing is stored here. */
export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return json({ error: "forbidden" }, 403);
    } catch {
      return json({ error: "forbidden" }, 403);
    }
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!limiter.check(ip)) return json({ error: "rate_limited" }, 429);

  if (Number(request.headers.get("content-length")) > DOCUMENT_MAX_BYTES + 64_000) return json({ error: "too_large" }, 413);
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (!(file instanceof File)) return json({ error: "invalid_request" }, 400);
  if (file.size > DOCUMENT_MAX_BYTES) return json({ error: "too_large" }, 413);
  if (!documentKind(file.name)) return json({ error: "unsupported" }, 415);

  let text: string;
  try {
    text = await extractDocumentText(file.name, new Uint8Array(await file.arrayBuffer()));
  } catch {
    return json({ error: "no_text" }, 422);
  }
  if (!text) return json({ error: "no_text" }, 422);
  const truncated = text.length > DOCUMENT_MAX_CHARS;

  try {
    const { deltas } = await streamCompletion(buildDocumentMessages(text.slice(0, DOCUMENT_MAX_CHARS)), {
      order: ["groq", "cloudflare"],
      configs: providerConfigs(),
      cooldown,
      signal: request.signal,
      maxTokens: 4000,
      temperature: 0.2,
      firstTokenTimeoutMs: 15_000,
      idleTimeoutMs: 15_000,
    });
    let output = "";
    for await (const delta of deltas) output += delta;
    // Document content is never logged.
    return json({ notes: parseDocumentNotes(output), truncated }, 200);
  } catch (err) {
    if (err instanceof AllProvidersFailedError) return json({ error: "unavailable" }, 503);
    throw err;
  }
}
```

The route test's "empty text" case: a text file of spaces gives `""` → 422. A file whose parser throws also maps to 422 `no_text`.

- [ ] **Step 5: Run the three test files and the whole suite** — `npx vitest run src/lib/server src/lib/profiles src/app/api` then `npm test`. Expected: PASS. If `idleTimeoutMs` is not already honoured by `streamCompletion`, leave the option out; the route test does not depend on it.

- [ ] **Step 6: Commit** — `git commit -m "Add a route that turns an uploaded document into draft notes"`

---

### Task 5: Browser call for document notes

**Files:**
- Create: `src/lib/profiles/document-client.ts`
- Test: `src/lib/profiles/document-client.test.ts`

**Interfaces:**
- Produces: `type DocumentResult = { ok: true; notes: DraftNote[]; truncated: boolean } | { ok: false; message: string }`, `notesFromDocument(file: File, fetchImpl?: typeof fetch): Promise<DocumentResult>`, `DOCUMENT_ACCEPT = ".txt,.md,.docx,.pdf"`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { notesFromDocument } from "./document-client";

const file = new File(["I'm Maya."], "me.txt");
const reply = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe("notesFromDocument", () => {
  it("returns the notes", async () => {
    const r = await notesFromDocument(file, reply(200, { notes: [{ kind: "about-me", text: "Hi" }], truncated: false }));
    expect(r).toEqual({ ok: true, notes: [{ kind: "about-me", text: "Hi" }], truncated: false });
  });

  it("checks size and type before sending", async () => {
    const f = vi.fn();
    expect(await notesFromDocument(new File(["x"], "a.doc"), f)).toMatchObject({ ok: false, message: expect.stringContaining("Word (.docx)") });
    expect(await notesFromDocument(new File([new Uint8Array(4 * 1024 * 1024 + 1)], "a.pdf"), f)).toMatchObject({ ok: false, message: expect.stringContaining("4 MB") });
    expect(f).not.toHaveBeenCalled();
  });

  it("explains each failure in plain words", async () => {
    expect(await notesFromDocument(file, reply(422, { error: "no_text" }))).toMatchObject({ message: expect.stringContaining("couldn't find any text") });
    expect(await notesFromDocument(file, reply(503, { error: "unavailable" }))).toMatchObject({ message: expect.stringContaining("try again") });
    expect(await notesFromDocument(file, reply(429, { error: "rate_limited" }))).toMatchObject({ message: expect.stringContaining("minute") });
    expect(await notesFromDocument(file, vi.fn().mockRejectedValue(new TypeError("offline")))).toMatchObject({ message: expect.stringContaining("connection") });
  });

  it("says when nothing useful was found", async () => {
    expect(await notesFromDocument(file, reply(200, { notes: [], truncated: false }))).toMatchObject({ ok: false, message: expect.stringContaining("No notes") });
  });
});
```

- [ ] **Step 2: Run and see it fail.**

- [ ] **Step 3: Implement**

```ts
import type { DraftNote } from "./notes";

export const DOCUMENT_ACCEPT = ".txt,.md,.docx,.pdf";
const MAX_BYTES = 4 * 1024 * 1024;

export type DocumentResult = { ok: true; notes: DraftNote[]; truncated: boolean } | { ok: false; message: string };

const MESSAGES: Record<string, string> = {
  too_large: "That file is over 4 MB. Try a shorter document.",
  unsupported: "OnBeat can read text (.txt, .md), Word (.docx) and PDF files.",
  no_text: "OnBeat couldn't find any text in that file. If it's a scan or photo, copy the text into a note instead.",
  rate_limited: "Too many documents at once. Wait a minute and try again.",
  unavailable: "The AI service is busy. Please try again in a minute. You can still type notes yourself.",
};

export async function notesFromDocument(file: File, fetchImpl: typeof fetch = fetch): Promise<DocumentResult> {
  if (!/\.(txt|md|docx|pdf)$/i.test(file.name)) return { ok: false, message: MESSAGES.unsupported };
  if (file.size > MAX_BYTES) return { ok: false, message: MESSAGES.too_large };
  const form = new FormData();
  form.append("file", file);
  let res: Response;
  try {
    res = await fetchImpl("/api/notes-from-document", { method: "POST", body: form });
  } catch {
    return { ok: false, message: "OnBeat couldn't reach the AI service. Check your connection and try again." };
  }
  const body = (await res.json().catch(() => ({}))) as { notes?: DraftNote[]; truncated?: boolean; error?: string };
  if (!res.ok || !body.notes) return { ok: false, message: MESSAGES[body.error ?? ""] ?? MESSAGES.unavailable };
  if (body.notes.length === 0) return { ok: false, message: "No notes came out of that document. You can type notes yourself instead." };
  return { ok: true, notes: body.notes, truncated: !!body.truncated };
}
```

- [ ] **Step 4: Run and see it pass.** **Step 5: Commit** — `git commit -m "Add the browser call for document notes"`

---

### Task 6: Note form, notes editor and document import components

**Files:**
- Create: `src/components/note-form.tsx`, `src/components/notes-editor.tsx`, `src/components/document-import.tsx`
- Test: `src/components/profile-components.test.tsx`

**Interfaces:**
- Consumes: `buildNote`, `noteFields`, `hasName`, `NOTE_MAX`, `DraftNote` (Task 2); `notesFromDocument`, `DOCUMENT_ACCEPT`, `DocumentResult` (Task 5).
- Produces:
  - `KIND_LABELS: Record<NoteKind, { group: string; add: string; name?: string; text: string }>` exported from `note-form.tsx`.
  - `<NoteForm kind initial?: { name: string; text: string } submitLabel onSave={(draft: DraftNote) => void} onCancel?={() => void} />`
  - `<NotesEditor notes: Note[] onSave={(note: Note) => void} onRemove={(id: string) => void} onDone={() => void} readDocument?: (file: File) => Promise<DocumentResult> />`
  - `<DocumentImport onSave={(drafts: DraftNote[]) => void} onCancel={() => void} readDocument?: (file: File) => Promise<DocumentResult> />`

Behaviour:

- `NoteForm`: for person and place, a "Name" input (required, maxLength 40) and a description textarea; otherwise one textarea. The textarea's limit is `NOTE_MAX - (name ? name.length + 2 : 0)`; below it a live counter `"{n} characters left"` tied with `aria-describedby`. Submit is disabled while required fields are blank. Submitting calls `onSave({ kind, name, text })` and clears the form when there was no `initial`.
- `NotesEditor`: heading "Your notes" (h2, focused on open), an intro line ("Replies are built from these notes. Only the few that fit the moment are sent with each reply."), then one section per group in this order: about-me ("About you"), person ("People"), place ("Places"), routine ("Routines"), preference ("Likes and dislikes"). Each note shows its text with "Edit" and "Delete" buttons (accessible names "Edit: {text}" and "Delete: {text}"). The pinned note has a small "Sent with every reply" label. Edit swaps the row for a `NoteForm` with `initial = noteFields(note)`; save calls `onSave(buildNote(draft, { id: note.id, pinned: note.pinned, now: Date.now() }))`. Delete asks inline ("Delete this note?" with "Delete" and "Keep"). Each group has an add button (`KIND_LABELS[kind].add`, e.g. "Add a person") that opens a `NoteForm`. At the bottom: "Add notes from a document" opens `DocumentImport`; its saves call `onSave(buildNote(d, { now }))` for each. A "Done" button calls `onDone`.
- `DocumentImport`: privacy text first (exact copy from spec decision 7), then a file input labelled "Choose a document (text, Word or PDF, up to 4 MB)". On choose: status "Reading your document…" (in a `role="status"` region), then either the error message (with the input still available) or the review: heading "Check these notes", line "Untick any you don't want. You can edit them after saving." plus, if truncated, "The document was long, so only the first part was used."; a checkbox per note (checked, label = note text, with the person/place name first); buttons "Save {n} notes" (disabled at 0) and "Cancel".

- [ ] **Step 1: Failing tests** (`src/components/profile-components.test.tsx`)

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DocumentImport } from "./document-import";
import { NoteForm } from "./note-form";
import { NotesEditor } from "./notes-editor";
import type { Note } from "@/lib/types";

describe("NoteForm", () => {
  it("needs a name for a person and saves both fields", async () => {
    const onSave = vi.fn();
    render(<NoteForm kind="person" submitLabel="Add person" onSave={onSave} />);
    const add = screen.getByRole("button", { name: "Add person" });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Name"), "Sam");
    await userEvent.type(screen.getByLabelText("Who they are to you"), "My barista");
    await userEvent.click(add);
    expect(onSave).toHaveBeenCalledWith({ kind: "person", name: "Sam", text: "My barista" });
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("counts the characters left, leaving room for the name", async () => {
    render(<NoteForm kind="place" submitLabel="Add place" onSave={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Name"), "Home");
    expect(screen.getByText("294 characters left")).toBeInTheDocument();
    expect(screen.getByLabelText("A few words about it")).toHaveAttribute("maxLength", "294");
  });
});

const notes: Note[] = [
  { id: "me", kind: "about-me", text: "I'm Maya.", entities: ["Maya"], updatedAt: 1, pinned: true },
  { id: "sam", kind: "person", text: "Sam: my barista", entities: ["Sam"], updatedAt: 1 },
];

describe("NotesEditor", () => {
  it("groups notes and marks the main one", () => {
    render(<NotesEditor notes={notes} onSave={vi.fn()} onRemove={vi.fn()} onDone={vi.fn()} />);
    const about = screen.getByRole("region", { name: "About you" });
    expect(within(about).getByText("Sent with every reply")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "People" })).getByText("Sam: my barista")).toBeInTheDocument();
  });

  it("edits a note in place, keeping its id and pin", async () => {
    const onSave = vi.fn();
    render(<NotesEditor notes={notes} onSave={onSave} onRemove={vi.fn()} onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit: Sam: my barista" }));
    const text = screen.getByLabelText("Who they are to you");
    expect(text).toHaveValue("my barista");
    await userEvent.clear(text);
    await userEvent.type(text, "the barista at Blue Door Café");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: "sam", text: "Sam: the barista at Blue Door Café" });
  });

  it("asks before deleting", async () => {
    const onRemove = vi.fn();
    render(<NotesEditor notes={notes} onSave={vi.fn()} onRemove={onRemove} onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete: Sam: my barista" }));
    expect(onRemove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onRemove).toHaveBeenCalledWith("sam");
  });

  it("adds a routine", async () => {
    const onSave = vi.fn();
    render(<NotesEditor notes={notes} onSave={onSave} onRemove={vi.fn()} onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Add a routine" }));
    await userEvent.type(screen.getByLabelText("Routine"), "Physio on Tuesdays");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({ kind: "routine", text: "Physio on Tuesdays" });
  });
});

describe("DocumentImport", () => {
  it("shows the privacy line, then saves only the ticked notes", async () => {
    const onSave = vi.fn();
    const readDocument = vi.fn().mockResolvedValue({
      ok: true,
      truncated: true,
      notes: [
        { kind: "about-me", text: "I have ALS." },
        { kind: "person", name: "Leila", text: "Leila is my daughter." },
      ],
    });
    render(<DocumentImport onSave={onSave} onCancel={vi.fn()} readDocument={readDocument} />);
    expect(screen.getByText(/sent to the AI service/)).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText(/Choose a document/), new File(["x"], "me.txt"));
    expect(await screen.findByText("The document was long, so only the first part was used.")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("I have ALS."));
    await userEvent.click(screen.getByRole("button", { name: "Save 1 note" }));
    expect(onSave).toHaveBeenCalledWith([{ kind: "person", name: "Leila", text: "Leila is my daughter." }]);
  });

  it("shows the error and lets the user try another file", async () => {
    const readDocument = vi.fn().mockResolvedValue({ ok: false, message: "OnBeat couldn't find any text in that file." });
    render(<DocumentImport onSave={vi.fn()} onCancel={vi.fn()} readDocument={readDocument} />);
    await userEvent.upload(screen.getByLabelText(/Choose a document/), new File(["x"], "scan.pdf"));
    expect(await screen.findByText("OnBeat couldn't find any text in that file.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Choose a document/)).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run and see it fail.**

- [ ] **Step 3: Implement the three components** following the behaviour above and the existing component style (`rounded-control`, `border-2 border-ink/30`, `min-h-12`, `text-body`, `text-label`, `text-muted`, `font-bold`; see `settings-panel.tsx` and `profile-picker.tsx`). `KIND_LABELS`:

```ts
export const KIND_LABELS: Record<NoteKind, { group: string; add: string; name?: string; text: string }> = {
  "about-me": { group: "About you", add: "Add something about you", text: "About you" },
  person: { group: "People", add: "Add a person", name: "Name", text: "Who they are to you" },
  place: { group: "Places", add: "Add a place", name: "Name", text: "A few words about it" },
  routine: { group: "Routines", add: "Add a routine", text: "Routine" },
  preference: { group: "Likes and dislikes", add: "Add a like or dislike", text: "Like or dislike" },
};
```

Each group is a `<section aria-labelledby>` so it is a named region. `DocumentImport` takes `readDocument = notesFromDocument` as the default.

- [ ] **Step 4: Run and see it pass**, then `npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "Add the notes editor and document import"`

---

### Task 7: Profile setup, profile menu, demo bar, demo picker

**Files:**
- Create: `src/components/profile-setup.tsx`, `src/components/profile-menu.tsx`, `src/components/demo-bar.tsx`
- Modify: `src/components/profile-picker.tsx`
- Test: append to `src/components/profile-components.test.tsx`

**Interfaces:**
- Consumes: `setupNotes`, `DraftNote` (Task 2), `NoteForm` (Task 6), `DocumentImport` (Task 6), `cleanName` (Task 1), `ProfileInfo` (Task 1).
- Produces:
  - `<ProfileSetup onDone={(name: string, notes: Note[]) => void} onDemo?={() => void} onCancel?={() => void} readDocument?={...} />`
  - `<ProfileMenu profiles: ProfileInfo[] activeId: string | null demoName: string | null onSwitch(id) onNotes() onNew() onExport() onImport(file: File) onRename(name: string) onDelete() onDemo() />`
  - `<DemoBar name: string onSetup() />`
  - `ProfilePicker` props unchanged except `onSkip` becomes `onBack` (label "Back").

Setup behaviour:
- Step 1: h2 "Set up OnBeat", line "OnBeat suggests replies from what it knows about you. This takes a minute, and you can change everything later." Field "What's your name?" (maxLength 40). "Next" disabled until the name has a non-space character. Enter in the field goes on. Under the step (only if `onDemo`): a link-style button "Try a demo first".
- Step 2: h2 "Tell OnBeat about you". Textarea labelled "About you", hint "For example: I have ALS, so I type to talk. I can hear fine. Please give me time to answer." Counter as in NoteForm, limit `NOTE_MAX - name.length - 5`. Button "Start from a document" opens `DocumentImport`; saved drafts are kept and listed as "{n} notes from your document" with a "Remove" button. Buttons "Back", "Next" (always enabled; skipping is fine).
- Step 3: h2 "Who do you talk to, and where?", line "Add a few people and places. They'll appear in the Talking to and Place lists." Two `NoteForm`s ("Add person", "Add place"); added ones listed with "Remove". Buttons "Back", "Finish".
- Finish: `onDone(cleanName(name), setupNotes({ name, about, drafts: [...documentDrafts, ...people, ...places] }, Date.now()))`.
- On each step change, focus the step heading (`tabIndex={-1}`). The step number shows as "Step 2 of 3".
- If `onCancel` is given, every step shows "Cancel".

Profile menu behaviour:
- A toggle button showing the profile name (or "Demo: {name}"), `aria-expanded`, `aria-controls`. The panel sits below the header and is not modal; Escape closes it and returns focus to the toggle.
- In a demo: buttons "Set up your own profile", "Try another demo", and, if profiles exist, "Switch to {name}" for each.
- With a profile: a list "Profiles" with each other profile as "Switch to {name}"; then "Your notes", "New profile", "Export this profile" (with hint "Saves a file you can import later or on another device"), "Import a profile" (a file input labelled that way, `accept=".json"`), "Rename" (inline form with "Save"/"Cancel"), "Delete this profile" (inline confirm: "Delete {name}? Their notes and phrases will be removed from this browser. Export first if you might want them back." with "Delete {name}" and "Keep"), "Try a demo".

- [ ] **Step 1: Failing tests** (append)

```tsx
import { ProfileSetup } from "./profile-setup";
import { ProfileMenu } from "./profile-menu";

describe("ProfileSetup", () => {
  it("walks through the steps and builds the notes", async () => {
    const onDone = vi.fn();
    render(<ProfileSetup onDone={onDone} onDemo={vi.fn()} />);
    const next = screen.getByRole("button", { name: "Next" });
    expect(next).toBeDisabled();
    await userEvent.type(screen.getByLabelText("What's your name?"), "  Maya {Enter}");
    expect(screen.getByRole("heading", { name: "Tell OnBeat about you" })).toHaveFocus();
    await userEvent.type(screen.getByLabelText("About you"), "I type to talk.");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(screen.getByLabelText("Name", { selector: "#person-name" }), "Sam");
    await userEvent.type(screen.getByLabelText("Who they are to you"), "my barista");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    const [name, notes] = onDone.mock.calls[0];
    expect(name).toBe("Maya");
    expect(notes.map((n: Note) => n.text)).toEqual(["I'm Maya. I type to talk.", "Sam: my barista"]);
  });

  it("goes back without losing what was typed", async () => {
    render(<ProfileSetup onDone={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("What's your name?"), "Tom");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("What's your name?")).toHaveValue("Tom");
    expect(screen.queryByRole("button", { name: "Try a demo first" })).toBeNull();
  });
});

describe("ProfileMenu", () => {
  const profiles = [
    { id: "a", name: "Maya", createdAt: 1 },
    { id: "b", name: "Tom", createdAt: 2 },
  ];
  const handlers = () => ({ onSwitch: vi.fn(), onNotes: vi.fn(), onNew: vi.fn(), onExport: vi.fn(), onImport: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onDemo: vi.fn() });

  it("switches profile and closes", async () => {
    const h = handlers();
    render(<ProfileMenu profiles={profiles} activeId="a" demoName={null} {...h} />);
    const toggle = screen.getByRole("button", { name: "Maya" });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("button", { name: "Switch to Tom" }));
    expect(h.onSwitch).toHaveBeenCalledWith("b");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("confirms before deleting", async () => {
    const h = handlers();
    render(<ProfileMenu profiles={profiles} activeId="a" demoName={null} {...h} />);
    await userEvent.click(screen.getByRole("button", { name: "Maya" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete this profile" }));
    expect(screen.getByText(/Export first/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete Maya" }));
    expect(h.onDelete).toHaveBeenCalled();
  });

  it("closes on Escape and returns focus", async () => {
    render(<ProfileMenu profiles={profiles} activeId="a" demoName={null} {...handlers()} />);
    const toggle = screen.getByRole("button", { name: "Maya" });
    await userEvent.click(toggle);
    await userEvent.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });

  it("offers setup in a demo", async () => {
    const h = handlers();
    render(<ProfileMenu profiles={[]} activeId={null} demoName="Maya" {...h} />);
    await userEvent.click(screen.getByRole("button", { name: "Demo: Maya" }));
    await userEvent.click(screen.getByRole("button", { name: "Set up your own profile" }));
    expect(h.onNew).toHaveBeenCalled();
  });
});
```

The person form inside setup uses `id="person-name"` for its name input so the test can tell it from the place form. `NoteForm` takes an optional `idPrefix` prop (default `useId()`), and setup passes `"person"` and `"place"`; the name input's id is `${idPrefix}-name`.

- [ ] **Step 2: Run and see it fail.**
- [ ] **Step 3: Implement** the three components and the picker change (heading "Try a demo", intro "These example people show how OnBeat works. Nothing you do in a demo is saved.", back button "Back").
- [ ] **Step 4: Run and see it pass**, `npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "Add profile setup, the profile menu and the demo bar"`

---

### Task 8: Wire profiles into the conversation screen

**Files:**
- Modify: `src/lib/memory/browser.ts`, `src/components/conversation-screen.tsx`
- Delete: `src/lib/memory/idb-persist.ts`, `src/lib/memory/idb-persist.test.ts`
- Test: `src/components/conversation-screen.test.tsx` (update existing cases that pick an example profile)

**Interfaces:**
- Consumes: everything above.
- Produces in `browser.ts`: `getBrowserRegistry(): Promise<ProfileRegistry>` (cached), `openProfileMemory(registry: ProfileRegistry, id: string): Promise<MemoryStore>`, `openDemoMemory(persona: Persona): Promise<MemoryStore>`; one shared embedder (`createBrowserEmbedder()` called once).

Screen changes (read the current file first; it is on `main` with the settings panel):

- State: `registry`, `registryVersion` (bumped after registry changes), `view: "loading" | "setup" | "demo-picker" | "notes" | "conversation"`, `demo: Persona | null`, `memory`.
- Load: `getBrowserRegistry()` → if `active()` open its memory and show conversation, else show setup. Fallback on error: `ProfileRegistry.open(memoryKeyValue(), { durable: false })`. If `!registry.durable`, show the existing notice.
- `openMemory(store, context?)`: `client?.cancel()`, stop speech, `dispatch({ type: "reset" })`, `gapTimer.reset()`, `setMemory(store)`, `dispatch({ type: "setContext", placeId, partnerId })`, bump `notesVersion`, `setView("conversation")`, `resetFocusToTop()`.
- `finishSetup(name, notes)`: `const p = await registry.create(name)`, `const store = await openProfileMemory(registry, p.id)`, `await store.replaceAll(notes, [])`, `void navigator.storage?.persist?.()`, `setDemo(null)`, `openMemory(store)`, then `dispatch({ type: "notice", text: "You can add or change notes any time from your profile menu." })`.
- `switchTo(id)`: `await registry.setActive(id)`, `setDemo(null)`, `openMemory(await openProfileMemory(registry, id))`.
- `startDemo(persona)`: `setDemo(persona)`, `openMemory(await openDemoMemory(persona), { placeId: persona.defaultPlaceId, partnerId: persona.defaultPartnerId })`.
- Notes view: `<NotesEditor notes={notes} onSave={async (n) => { await memory.upsertNote(n); client?.clearCache(); bump }} onRemove={...removeNote...} onDone={() => setView("conversation")} />`.
- Export: build the JSON with `exportProfile(active.name, memory.notes(), memory.phrases(), new Date())`, download with a temporary `<a download>` and `URL.createObjectURL`, then announce "Profile exported".
- Import: `parseImport(await file.text())`; on null announce and show notice "This file isn't an OnBeat profile export."; otherwise `create(uniqueName(name))`, `persistFor(id).save({ version: 1, notes, phrases })`, `switchTo(id)`, announce "Imported {name}".
- Delete: `await registry.remove(active.id)`; if `registry.active()` switch to it, else `setMemory(null)` and `setView("setup")`.
- Rename: `registry.rename`, bump.
- Header: the `ProfileMenu` replaces "Example profiles"; it is hidden while `view === "setup"` and there is no profile and no demo. `DemoBar` shows under the header in a demo.
- The conversation grid stays mounted and is `hidden` unless `view === "conversation"`, as today.
- Setup's `onDemo` shows the demo picker; setup's `onCancel` is passed only when there is a profile or demo to return to.
- Shortcuts are enabled only in the conversation view (`enabled: view === "conversation"`).

- [ ] **Step 1: Update `conversation-screen.test.tsx`** so the tests that start with an example profile first click "Try a demo first" (the screen now opens on setup), and add:

```tsx
it("opens on setup with no profiles, and a finished setup shows the conversation", async () => {
  renderScreen();
  await userEvent.type(await screen.findByLabelText("What's your name?"), "Maya");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.type(screen.getByLabelText("Name", { selector: "#person-name" }), "Sam");
  await userEvent.type(screen.getByLabelText("Who they are to you"), "my barista");
  await userEvent.click(screen.getByRole("button", { name: "Add person" }));
  await userEvent.click(screen.getByRole("button", { name: "Finish" }));
  expect(await screen.findByRole("option", { name: "Sam" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Maya" })).toBeInTheDocument();
});
```

Use the helper the existing file already uses to render the screen and reset IndexedDB between tests (read the file; if it has none, `import "fake-indexeddb/auto"` and delete the `onbeat` database in `beforeEach` with `indexedDB.deleteDatabase("onbeat")`, and reset the cached registry through a test-only `resetBrowserMemoryForTests()` export in `browser.ts`).

- [ ] **Step 2: Run and see the new test fail.**
- [ ] **Step 3: Implement** the changes above.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`. All pass.
- [ ] **Step 5: Commit** — `git commit -m "Open on profile setup and switch between saved profiles"`

---

### Task 9: End-to-end tests and README

**Files:**
- Modify: `tests/e2e/helpers.ts` (`startWithMaya` clicks "Try a demo first" then Maya; `prepare` also mocks `**/api/notes-from-document` with two notes), `tests/e2e/conversation.spec.ts` (axe test: first screen is setup; go through the demo link)
- Create: `tests/e2e/profiles.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Write `tests/e2e/profiles.spec.ts`**

```ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { prepare } from "./helpers";

async function setUp(page: Page, name: string) {
  await page.getByLabel("What's your name?").fill(name);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("About you").fill("I type to talk. I can hear fine.");
  await page.getByRole("button", { name: "Next" }).click();
  await page.locator("#person-name").fill("Sam");
  await page.getByLabel("Who they are to you").fill("my barista");
  await page.getByRole("button", { name: "Add person" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
}

test("first visit sets up a profile that is still there after a reload", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await setUp(page, "Priya");
  await expect(page.getByLabel("Talking to")).toContainText("Sam");
  await page.reload();
  await expect(page.getByRole("button", { name: "Priya" })).toBeVisible();
  await expect(page.getByLabel("Talking to")).toContainText("Sam");
});

test("a demo leaves no profile behind", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Try a demo first" }).click();
  await page.getByRole("button", { name: /^Maya/ }).click();
  await expect(page.getByText("Nothing you do here is saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("What's your name?")).toBeVisible();
});

test("two profiles, switching, and deleting back to setup", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await setUp(page, "Priya");
  await page.getByRole("button", { name: "Priya" }).click();
  await page.getByRole("button", { name: "New profile" }).click();
  await page.getByLabel("What's your name?").fill("Tom");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByLabel("Talking to")).not.toContainText("Sam");
  await page.getByRole("button", { name: "Tom" }).click();
  await page.getByRole("button", { name: "Switch to Priya" }).click();
  await expect(page.getByLabel("Talking to")).toContainText("Sam");
  for (const name of ["Priya", "Tom"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("button", { name: "Delete this profile" }).click();
    await page.getByRole("button", { name: `Delete ${name}` }).click();
  }
  await expect(page.getByLabel("What's your name?")).toBeVisible();
});

test("export then import makes a second copy", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await setUp(page, "Priya");
  await page.getByRole("button", { name: "Priya" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export this profile" }).click()]);
  const path = await download.path();
  await page.getByRole("button", { name: "Priya" }).click();
  await page.getByLabel("Import a profile").setInputFiles(path!);
  await expect(page.getByRole("button", { name: "Priya (2)" })).toBeVisible();
  await expect(page.getByLabel("Talking to")).toContainText("Sam");
});

test("notes from a document are reviewed before saving", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await setUp(page, "Priya");
  await page.getByRole("button", { name: "Priya" }).click();
  await page.getByRole("button", { name: "Your notes" }).click();
  await page.getByRole("button", { name: "Add notes from a document" }).click();
  await page.getByLabel(/Choose a document/).setInputFiles({ name: "me.txt", mimeType: "text/plain", buffer: Buffer.from("I love chess.") });
  await page.getByRole("button", { name: "Save 2 notes" }).click();
  await expect(page.getByRole("region", { name: "Likes and dislikes" })).toContainText("I love chess.");
});

for (const theme of [undefined, "dark", "contrast"]) {
  test(`setup and notes pass axe (${theme ?? "light"})`, async ({ page }) => {
    await prepare(page, theme);
    await page.goto("/");
    const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
    await setUp(page, "Priya");
    await page.getByRole("button", { name: "Priya" }).click();
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Your notes" }).click();
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  });
}

test("setup has no sideways scroll at 320 px", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
```

The mocked document route in `prepare` returns `{ notes: [{ kind: "preference", text: "I love chess." }, { kind: "about-me", text: "I play online." }], truncated: false }`.

- [ ] **Step 2: Run** `npx playwright test` (builds and starts the app on port 3100). Fix what fails. Expected: all pass except the existing skipped test.
- [ ] **Step 3: README**: replace the example-profile paragraph with a short description of profiles (setup, several profiles, notes, document import and what it sends, export and import). Plain voice.
- [ ] **Step 4: Commit** — `git commit -m "Add end-to-end tests for profiles and update the README"`

---

## Self-review notes

- Spec decisions 1 to 13 map to: 1, 2, 4 (Task 7), 3 (Tasks 7, 8, 9), 5 (Tasks 2, 6, 7), 6 (Task 6), 7 (Tasks 4 to 6), 8 (Task 7), 9 (Task 8), 10 (Tasks 3, 8, 9), 11 (Tasks 7, 8, 9), 12 (Task 8), 13 (Task 1).
- Save failures (quota): `MemoryStore` save rejects; Task 8 wraps note saves in try/catch and announces "Couldn't save. Your browser's storage may be full."
