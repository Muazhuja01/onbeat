import { contentWords } from "@/lib/learning/session";
import type { MemoryStore } from "@/lib/memory/store";
import { hasName, NOTE_MAX, noteFields } from "@/lib/profiles/notes";
import type { Note } from "@/lib/types";
import { ASSIST_NOTES_CHARS, ASSIST_NOTES_MAX, ASSIST_PHRASES_MAX, PHRASE_MAX } from "./protocol";

/** Longest `for` name the route accepts. */
const FOR_MAX = 80;
/** Ids the route accepts. Imported profiles are not held to this. */
const okId = (id: string) => id.length >= 1 && id.length <= 64;

/** Imported notes may be up to 2,000 characters; the route takes 300. */
const clipped = (n: Note): Note => (n.text.length > NOTE_MAX ? { ...n, text: n.text.slice(0, NOTE_MAX) } : n);
const size = (notes: Note[]) => notes.reduce((n, x) => n + clipped(x).text.length, 0);

/**
 * Every note when they fit in the budget, about-me first. Otherwise the about-me note and
 * the best matches for each of the user's lines in turn, up to the budget (spec decision 22).
 * Notes come back whole; the request cuts each to NOTE_MAX, and the budget counts the cut text.
 */
export async function pickAssistNotes(memory: MemoryStore, userTexts: string[]): Promise<Note[]> {
  const all = memory
    .notes()
    .filter((n) => okId(n.id))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  if (all.length <= ASSIST_NOTES_MAX && size(all) <= ASSIST_NOTES_CHARS) return all;
  const picked = new Map<string, Note>();
  let used = 0;
  const add = (n: Note) => {
    const length = clipped(n).text.length;
    if (picked.has(n.id) || !okId(n.id) || picked.size >= ASSIST_NOTES_MAX || used + length > ASSIST_NOTES_CHARS) return;
    picked.set(n.id, n);
    used += length;
  };
  all.filter((n) => n.pinned).forEach(add);
  const perLine = await Promise.all(
    [...userTexts].reverse().map((t) => {
      const q = contentWords(t);
      return q ? memory.searchNotes(q, { now: new Date() }, 12) : Promise.resolve([]);
    }),
  );
  for (let rank = 0; rank < 12; rank++) for (const found of perLine) if (found[rank]) add(found[rank]);
  return [...picked.values()];
}

/** A note as the request carries it. */
export const noteForRequest = (n: Note) => ({ id: n.id, kind: n.kind, text: clipped(n).text });

/**
 * Quick phrases with the name of the person or place each is for, cut to what the route
 * takes: at most 100, those for a note being sent first, then the newest.
 */
export function quickPhrasesForRequest(memory: MemoryStore, sentNoteIds: ReadonlySet<string> = new Set()): { id: string; text: string; for?: string }[] {
  const all = memory.allQuickPhrases().filter((p) => okId(p.id));
  const forSent = (p: (typeof all)[number]) => sentNoteIds.has(p.context.partnerId ?? "") || sentNoteIds.has(p.context.placeId ?? "");
  const chosen = [...all.filter(forSent), ...all.filter((p) => !forSent(p))].slice(0, ASSIST_PHRASES_MAX);
  return chosen.map((p) => {
    const tied = memory.getNote(p.context.partnerId ?? p.context.placeId ?? "");
    const name = tied && hasName(tied.kind) ? noteFields(tied).name.slice(0, FOR_MAX) : undefined;
    return { id: p.id, text: p.text.slice(0, PHRASE_MAX), ...(name ? { for: name } : {}) };
  });
}
