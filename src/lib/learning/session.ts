import type { MemoryStore } from "@/lib/memory/store";
import type { KeyValue } from "@/lib/profiles/kv";
import { hasName, NOTE_MAX, noteFields } from "@/lib/profiles/notes";
import type { Note } from "@/lib/types";
import { Batcher, type SendResult } from "./batcher";
import { postLearnBatch, type LearnResult } from "./client";
import { PendingStore } from "./pending";
import { localIsoDate } from "./prompt";
import { LEARN_LINE_MAX, LEARN_NOTES_MAX, type LearnRequest, type Proposal } from "./protocol";
import { LearningQueue } from "./queue";
import type { PendingSuggestion, QueuedLine, Speaker } from "./types";

export interface NewLine {
  speaker: Speaker;
  text: string;
  partnerName?: string;
  placeName?: string;
}

const RELATED_PER_LINE = 3;

/** The pinned about-me note, then the best matches for each line in turn, at most 9 notes in all. */
export async function relatedNotes(memory: MemoryStore, lines: QueuedLine[]): Promise<Note[]> {
  const picked = new Map<string, Note>();
  const pinned = memory.notes().find((n) => n.pinned);
  if (pinned) picked.set(pinned.id, pinned);
  const perLine = await Promise.all(lines.map((l) => memory.searchNotes(l.text, { now: new Date() }, RELATED_PER_LINE)));
  for (let rank = 0; rank < RELATED_PER_LINE; rank++) {
    for (const found of perLine) {
      const note = found[rank];
      if (note && picked.size < LEARN_NOTES_MAX) picked.set(note.id, note);
    }
  }
  return [...picked.values()];
}

/** A checked proposal as the review screen shows it. An edit of a note that is gone becomes a new note. */
export function toPending(p: Proposal, lines: Map<string, QueuedLine>, memory: MemoryStore, now: number): PendingSuggestion {
  const target = p.action === "edit" && p.noteId ? memory.getNote(p.noteId) : undefined;
  const kind = target?.kind ?? p.kind;
  const name = hasName(kind) ? (p.name ?? (target ? noteFields(target).name : "")) : "";
  return {
    id: `s_${crypto.randomUUID()}`,
    action: target ? "edit" : "add",
    draft: { kind, ...(name ? { name } : {}), text: p.text },
    ...(target ? { noteId: target.id, oldText: target.text } : {}),
    sources: p.lineIds.flatMap((id) => {
      const l = lines.get(id);
      return l ? [{ speaker: l.speaker, text: l.text, at: l.at, ...(l.partnerName ? { partnerName: l.partnerName } : {}) }] : [];
    }),
    createdAt: now,
  };
}

/** Learning for one open profile: lines in, suggestions out. Demos never get one. */
export class LearningSession {
  private constructor(
    private readonly queue: LearningQueue,
    readonly pending: PendingStore,
    private readonly batcher: Batcher,
    private enabled: boolean,
    private readonly now: () => number,
  ) {}

  static async open(opts: {
    kv: KeyValue;
    profileId: string;
    memory: MemoryStore;
    enabled: boolean;
    post?: (body: LearnRequest) => Promise<LearnResult>;
    now?: () => number;
  }): Promise<LearningSession> {
    const now = opts.now ?? Date.now;
    const post = opts.post ?? ((body: LearnRequest) => postLearnBatch(body));
    const { memory } = opts;
    const [queue, pending] = await Promise.all([LearningQueue.open(opts.kv, opts.profileId, now), PendingStore.open(opts.kv, opts.profileId)]);

    const send = async (lines: QueuedLine[]): Promise<SendResult> => {
      const notes = await relatedNotes(memory, lines);
      const body: LearnRequest = {
        today: localIsoDate(new Date(now())),
        lines: lines.map(({ id, speaker, text, partnerName, placeName }) => ({
          id,
          speaker,
          text,
          ...(partnerName ? { partnerName } : {}),
          ...(placeName ? { placeName } : {}),
        })),
        notes: notes.map((n) => ({ id: n.id, kind: n.kind, text: n.text.slice(0, NOTE_MAX) })),
      };
      const result = await post(body);
      // A refused batch counts as sent, so its lines are dropped instead of sent forever.
      if (!result.ok) return result.retry ? "failed" : "sent";
      const byId = new Map(lines.map((l) => [l.id, l]));
      await pending.merge(
        result.proposals.map((p) => toPending(p, byId, memory, now())),
        memory.notes(),
      );
      return "sent";
    };

    return new LearningSession(queue, pending, new Batcher(queue, send), opts.enabled, now);
  }

  async addLine(line: NewLine): Promise<void> {
    const text = line.text.trim().slice(0, LEARN_LINE_MAX);
    if (!this.enabled || !text) return;
    await this.queue.add({
      id: crypto.randomUUID(),
      speaker: line.speaker,
      text,
      at: this.now(),
      ...(line.partnerName ? { partnerName: line.partnerName.slice(0, 60) } : {}),
      ...(line.placeName ? { placeName: line.placeName.slice(0, 80) } : {}),
    });
    this.batcher.lineAdded();
  }

  /** Turning learning off empties the queue; suggestions already made stay for review. */
  async setEnabled(on: boolean): Promise<void> {
    this.enabled = on;
    if (!on) await this.queue.clear();
  }

  pageHidden(): void {
    if (this.enabled) this.batcher.pageHidden();
  }

  dispose(): void {
    this.batcher.dispose();
  }
}
