import { contentWords } from "@/lib/learning/session";
import type { MemoryStore } from "@/lib/memory/store";
import { hasName, noteFields } from "@/lib/profiles/notes";
import type { Note } from "@/lib/types";
import { ASSIST_NOTES_CHARS } from "./protocol";

const size = (notes: Note[]) => notes.reduce((n, x) => n + x.text.length, 0);

/**
 * Every note when they fit in the budget, about-me first. Otherwise the about-me note and
 * the best matches for each of the user's lines in turn, up to the budget (spec decision 22).
 */
export async function pickAssistNotes(memory: MemoryStore, userTexts: string[]): Promise<Note[]> {
  const all = memory.notes().sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  if (size(all) <= ASSIST_NOTES_CHARS) return all;
  const picked = new Map<string, Note>();
  let used = 0;
  const add = (n: Note) => {
    if (picked.has(n.id) || used + n.text.length > ASSIST_NOTES_CHARS) return;
    picked.set(n.id, n);
    used += n.text.length;
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

/** Quick phrases with the name of the person or place each is for. */
export function quickPhrasesForRequest(memory: MemoryStore): { id: string; text: string; for?: string }[] {
  return memory.allQuickPhrases().map((p) => {
    const tied = memory.getNote(p.context.partnerId ?? p.context.placeId ?? "");
    const name = tied && hasName(tied.kind) ? noteFields(tied).name : undefined;
    return { id: p.id, text: p.text, ...(name ? { for: name } : {}) };
  });
}
