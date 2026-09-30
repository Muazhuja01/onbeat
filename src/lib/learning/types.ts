import type { DraftNote } from "@/lib/profiles/notes";

export type Speaker = "user" | "partner";

/** A line of conversation waiting to be learned from. */
export interface QueuedLine {
  id: string;
  speaker: Speaker;
  text: string;
  at: number;
  /** Who the user was talking with, from the Talking with list. */
  partnerName?: string;
  /** Where, from the Place list. */
  placeName?: string;
}

/** The line a suggestion came from, as the review screen quotes it. */
export interface SourceLine {
  speaker: Speaker;
  text: string;
  at: number;
  partnerName?: string;
}

/** A suggested note waiting for the user to keep, edit or skip it. */
export interface PendingSuggestion {
  id: string;
  action: "add" | "edit";
  draft: DraftNote;
  /** For an edit: the note it changes. */
  noteId?: string;
  /** For an edit: the note's text when the change was suggested. */
  oldText?: string;
  sources: SourceLine[];
  createdAt: number;
}
