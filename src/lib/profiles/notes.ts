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
      const ordinary = word === "I" || COMMON_WORDS.has(word.toLowerCase());
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

/** The text a draft is stored as: "Name: description" for a person or place, unless the description already names them. */
export function composeNoteText(draft: DraftNote): string {
  const name = hasName(draft.kind) ? (draft.name ?? "").trim() : "";
  const body = draft.text.trim();
  const mentions = name && body.toLowerCase().includes(name.toLowerCase());
  return clip(name && !mentions ? (body ? `${name}: ${body}` : name) : body);
}

export function buildNote(draft: DraftNote, opts: { id?: string; pinned?: boolean; now: number }): Note {
  const name = hasName(draft.kind) ? (draft.name ?? "").trim() : "";
  const text = composeNoteText(draft);
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

/**
 * The name an edit of a person or place note is saved with. A name the edit gives that isn't
 * the stored one is used as given. The stored name stays when the note held it as a "Name: "
 * label, when the new text still mentions it, when the new text is a fragment ("moving to
 * Leeds in May" is still about Sam), or when the old note started with the name and the new
 * text doesn't start with another one ("My flat on Elm Road." is still Home). So
 * "Dr. Chen at Lakeview Clinic is my family doctor." edited to "Dr. Osei at Lakeview Clinic
 * is my family doctor." doesn't get "Dr. Chen: " in front, and "Home is my apartment on Cedar
 * Street." edited to "Home is my flat on Birch Road." doesn't get "Cedar Street: ", since the
 * name sat inside the old sentence and the new one replaced it.
 */
export function editName(target: Note, sent: string | undefined, text: string): string {
  if (!hasName(target.kind)) return "";
  const given = sent?.trim() ?? "";
  const stored = noteFields(target);
  if (given && given.toLowerCase() !== stored.name.toLowerCase()) return given;
  if (!stored.name) return "";
  const labelled = stored.text !== target.text;
  const escaped = stored.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentioned = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(text);
  const fragment = /^\p{Ll}/u.test(text.trim());
  const wasSubject = new RegExp(`^${escaped}(?![\\p{L}\\p{N}])`, "iu").test(target.text.trim());
  const first = text.trim().replace(/^(?:Dr|Mr|Mrs|Ms|Mx)\.?\s+/, "").match(WORD)?.[0] ?? "";
  const startsWithName = /^\p{Lu}/u.test(first) && first !== "I" && !COMMON_WORDS.has(first.toLowerCase());
  return labelled || mentioned || fragment || (wasSubject && !startsWithName) ? stored.name : "";
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
