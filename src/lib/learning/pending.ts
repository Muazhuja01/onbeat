import type { KeyValue } from "@/lib/profiles/kv";
import { composeNoteText } from "@/lib/profiles/notes";
import { isNearDuplicate } from "@/lib/suggest/validate";
import { tokenize } from "@/lib/text";
import type { Note } from "@/lib/types";
import { pendingKey, skippedKey } from "./keys";
import { isDeleted } from "./lifecycle";
import type { PendingSuggestion } from "./types";

export const PENDING_MAX = 30;
export const SKIPPED_MAX = 200;

const words = (text: string) => tokenize(text).join(" ");
const textOf = (s: PendingSuggestion) => composeNoteText(s.draft);

/** One profile's suggested notes waiting for review, plus what the user skipped so it isn't suggested again. */
export class PendingStore {
  private readonly listeners = new Set<() => void>();

  private constructor(
    private readonly kv: KeyValue,
    private readonly profileId: string,
    private items: PendingSuggestion[],
    private skipped: string[],
  ) {}

  static async open(kv: KeyValue, profileId: string): Promise<PendingStore> {
    const [items, skipped] = await Promise.all([
      kv.get<PendingSuggestion[]>(pendingKey(profileId)).catch(() => undefined),
      kv.get<string[]>(skippedKey(profileId)).catch(() => undefined),
    ]);
    return new PendingStore(kv, profileId, items ?? [], skipped ?? []);
  }

  /** Newest first. */
  list(): PendingSuggestion[] {
    return [...this.items];
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /**
   * Adds suggestions, newest first, keeping one batch in the model's order. Drops one
   * the user skipped before, a new note that repeats a note, and an edit already made.
   * Replaces a waiting edit of the same note and a waiting near copy. Returns how many were added.
   */
  async merge(incoming: PendingSuggestion[], notes: Note[]): Promise<number> {
    let items = this.items;
    let added = 0;
    for (const s of [...incoming].reverse()) {
      const text = textOf(s);
      if (this.skipped.some((f) => isNearDuplicate(text, f))) continue;
      const target = s.noteId ? notes.find((n) => n.id === s.noteId) : undefined;
      if (target ? words(target.text) === words(text) : notes.some((n) => isNearDuplicate(text, n.text))) continue;
      items = [s, ...items.filter((p) => !((s.noteId && p.noteId === s.noteId) || isNearDuplicate(textOf(p), text)))];
      added++;
    }
    if (added === 0) return 0;
    this.items = items.slice(0, PENDING_MAX);
    await this.save(false);
    return added;
  }

  /** After Keep: gone from the list, not remembered as skipped. */
  async remove(id: string): Promise<void> {
    this.items = this.items.filter((p) => p.id !== id);
    await this.save(false);
  }

  async skip(id: string): Promise<void> {
    const s = this.items.find((p) => p.id === id);
    if (!s) return;
    this.skipped = [...this.skipped, words(textOf(s))].slice(-SKIPPED_MAX);
    this.items = this.items.filter((p) => p.id !== id);
    await this.save(true);
  }

  async skipAll(): Promise<void> {
    this.skipped = [...this.skipped, ...this.items.map((s) => words(textOf(s)))].slice(-SKIPPED_MAX);
    this.items = [];
    await this.save(true);
  }

  /** For an imported profile. */
  async replaceAll(items: PendingSuggestion[]): Promise<void> {
    this.items = items.slice(0, PENDING_MAX);
    await this.save(false);
  }

  private async save(withSkipped: boolean): Promise<void> {
    this.listeners.forEach((cb) => cb());
    if (isDeleted(this.profileId)) return;
    try {
      await this.kv.set(pendingKey(this.profileId), this.items);
      if (withSkipped) await this.kv.set(skippedKey(this.profileId), this.skipped);
    } catch {
      // Storage full or blocked: suggestions still work for this visit.
    }
  }
}
