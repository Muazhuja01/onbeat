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

    const pinnedIds = [...this.notesById.values()].filter((n) => n.pinned && !contextIds.includes(n.id)).map((n) => n.id);
    const ranked = [...scores.entries()]
      .filter(([id]) => !contextIds.includes(id) && !pinnedIds.includes(id) && this.notesById.has(id))
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => this.notesById.get(id)!);
    return [...[...contextIds, ...pinnedIds].map((id) => this.notesById.get(id)!), ...ranked].slice(0, k);
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
