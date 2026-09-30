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
