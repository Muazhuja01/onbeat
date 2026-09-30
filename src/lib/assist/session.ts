import { localIsoDate } from "@/lib/learning/prompt";
import type { MemoryStore } from "@/lib/memory/store";
import { buildNote, composeNoteText, hasName, noteFields, type DraftNote } from "@/lib/profiles/notes";
import { tokenize } from "@/lib/text";
import { postAssist, type AssistResult } from "./client";
import { pickAssistNotes, quickPhrasesForRequest } from "./notes";
import { ASSIST_USER_MAX, type AssistJob, type AssistProposal, type AssistRequest } from "./protocol";

export const JOB_TEXT: Record<AssistJob, string> = {
  update: "Update my information",
  prepare: "Prepare for an appointment",
  phrases: "Make quick phrases",
};
export const SORRY = "Sorry, I didn't get that. Could you say it another way?";
export const LIMIT_TEXT = "This chat is as long as it can be. Close it and start a new one to carry on.";
const RATE_WAIT_MS = 10_000;

export interface ChatLine {
  id: string;
  speaker: "user" | "assistant";
  text: string;
  failed?: boolean;
  proposed?: string[];
}
export type CardAction = "add" | "edit" | "remove" | "phrase";
export interface AssistCard {
  id: string;
  /** The assistant line it came with. */
  lineId: string;
  action: CardAction;
  /** add and edit */
  draft?: DraftNote;
  /** edit and remove */
  noteId?: string;
  /** edit and remove: the note's text when the card was made. */
  oldText?: string;
  /** phrase */
  phrase?: { text: string; forName?: string };
  /** The user's lines it came from. */
  sources: string[];
  state: "open" | "kept" | "skipped";
  /** Set when Keep found the note changed since. */
  changed?: boolean;
}
export type AssistStatus = "idle" | "waiting" | "rate_limited";
export interface AssistState {
  job: AssistJob | null;
  lines: ChatLine[];
  cards: AssistCard[];
  status: AssistStatus;
  closed: boolean;
}
export type KeepOutcome = "kept" | "changed" | "duplicate" | "gone";

const words = (t: string) => tokenize(t).join(" ");
const newId = () => crypto.randomUUID();

/** How a card is described back to the model, so it isn't offered twice. */
function describe(card: AssistCard): string {
  switch (card.action) {
    case "add":
      return `new note "${composeNoteText(card.draft!)}"`;
    case "edit":
      return `change "${composeNoteText(card.draft!)}"`;
    case "remove":
      return `remove "${card.oldText}"`;
    default:
      return `phrase "${card.phrase!.text}"`;
  }
}

const sameCard = (a: AssistCard, b: AssistCard) => a.action === b.action && describe(a) === describe(b);

/**
 * One assistant chat. Kept in memory only: closing it discards it (spec decision 4). Every
 * change goes through a card the user keeps, and a card never overwrites a note that
 * changed after the card was made.
 */
export class AssistSession {
  private s: AssistState = { job: null, lines: [], cards: [], status: "idle", closed: false };
  private listeners = new Set<() => void>();
  private keeping = new Set<string>();
  private readonly memory: MemoryStore;
  private readonly post: (body: AssistRequest) => Promise<AssistResult>;
  private readonly now: () => number;

  constructor(opts: { memory: MemoryStore; post?: (body: AssistRequest) => Promise<AssistResult>; now?: () => number }) {
    this.memory = opts.memory;
    this.post = opts.post ?? ((body) => postAssist(body));
    this.now = opts.now ?? Date.now;
  }

  get state(): AssistState {
    return this.s;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(next: Partial<AssistState>) {
    this.s = { ...this.s, ...next };
    for (const fn of this.listeners) fn();
  }

  userCount(): number {
    return this.s.lines.filter((l) => l.speaker === "user").length;
  }

  openCount(): number {
    return this.s.cards.filter((c) => c.state === "open").length;
  }

  async chooseJob(job: AssistJob): Promise<void> {
    if (this.s.lines.length > 0) return;
    this.set({ job });
    await this.send(JOB_TEXT[job]);
  }

  async send(text: string): Promise<void> {
    const t = text.trim();
    if (!t || this.s.closed || this.s.status !== "idle" || this.userCount() >= ASSIST_USER_MAX) return;
    this.set({ lines: [...this.s.lines, { id: newId(), speaker: "user", text: t }] });
    await this.turn();
  }

  async retry(): Promise<void> {
    if (this.s.closed || this.s.status !== "idle" || !this.s.lines.some((l) => l.failed)) return;
    this.set({ lines: this.s.lines.map((l) => (l.failed ? { ...l, failed: false } : l)) });
    await this.turn();
  }

  private async turn(): Promise<void> {
    this.set({ status: "waiting" });
    const userTexts = this.s.lines.filter((l) => l.speaker === "user").map((l) => l.text);
    const notes = await pickAssistNotes(this.memory, userTexts);
    if (this.s.closed) return;
    const body: AssistRequest = {
      job: this.s.job,
      today: localIsoDate(new Date(this.now())),
      lines: this.s.lines.map(({ id, speaker, text, proposed }) => ({ id, speaker, text, ...(speaker === "assistant" ? { proposed: proposed ?? [] } : {}) })),
      notes: notes.map((n) => ({ id: n.id, kind: n.kind, text: n.text })),
      phrases: quickPhrasesForRequest(this.memory),
    };
    const result = await this.post(body);
    if (this.s.closed) return;

    const lastUser = this.s.lines.findLast((l) => l.speaker === "user")!;
    if (!result.ok && result.reason !== "unreadable") {
      this.set({ lines: this.s.lines.map((l) => (l.id === lastUser.id ? { ...l, failed: true } : l)), status: result.reason === "rate_limited" ? "rate_limited" : "idle" });
      if (result.reason === "rate_limited") setTimeout(() => !this.s.closed && this.set({ status: "idle" }), RATE_WAIT_MS);
      return;
    }

    const lineId = newId();
    const say = result.ok ? result.say : SORRY;
    const cards = result.ok ? this.toCards(result.proposals, lineId, body) : [];
    const lines: ChatLine[] = [...this.s.lines, { id: lineId, speaker: "assistant", text: say, proposed: cards.map(describe) }];
    if (lines.filter((l) => l.speaker === "user").length >= ASSIST_USER_MAX) lines.push({ id: newId(), speaker: "assistant", text: LIMIT_TEXT });
    this.set({ lines, cards: [...this.s.cards, ...cards], status: "idle" });
  }

  private toCards(proposals: AssistProposal[], lineId: string, body: AssistRequest): AssistCard[] {
    const text = new Map(body.lines.map((l) => [l.id, l.text]));
    const made: AssistCard[] = [];
    for (const p of proposals) {
      const sources = p.lineIds.map((id) => text.get(id) ?? "").filter(Boolean);
      const base = { id: newId(), lineId, sources, state: "open" as const };
      let card: AssistCard;
      if (p.action === "phrase") card = { ...base, action: "phrase", phrase: { text: p.text, ...(p.for ? { forName: p.for } : {}) } };
      else if (p.action === "remove") {
        const target = this.memory.getNote(p.noteId);
        if (!target || target.pinned) continue;
        card = { ...base, action: "remove", noteId: p.noteId, oldText: target.text };
      } else if (p.action === "edit") {
        const target = this.memory.getNote(p.noteId);
        if (!target) continue;
        card = { ...base, action: "edit", noteId: p.noteId, oldText: target.text, draft: { kind: target.kind, ...(p.name ? { name: p.name } : {}), text: p.text } };
      } else card = { ...base, action: "add", draft: { kind: p.kind, ...(p.name ? { name: p.name } : {}), text: p.text } };
      if ([...this.s.cards, ...made].some((c) => sameCard(c, card))) continue;
      made.push(card);
    }
    return made;
  }

  private mark(cardId: string, patch: Partial<AssistCard>) {
    this.set({ cards: this.s.cards.map((c) => (c.id === cardId ? { ...c, ...patch } : c)) });
  }

  skip(cardId: string): void {
    if (this.s.cards.find((c) => c.id === cardId)?.state === "open") this.mark(cardId, { state: "skipped" });
  }

  /** Saves a card. `edited` carries what the user changed with Edit. */
  async keep(cardId: string, edited: { draft?: DraftNote; phraseText?: string } = {}): Promise<KeepOutcome> {
    const card = this.s.cards.find((c) => c.id === cardId);
    if (!card || card.state !== "open" || this.keeping.has(cardId)) return "gone";
    this.keeping.add(cardId);
    try {
      const outcome = await this.apply(card, edited);
      if (outcome === "kept") this.mark(cardId, { state: "kept" });
      else if (outcome === "changed") this.mark(cardId, { changed: true });
      else this.mark(cardId, { state: "skipped" });
      return outcome;
    } finally {
      this.keeping.delete(cardId);
    }
  }

  private async apply(card: AssistCard, edited: { draft?: DraftNote; phraseText?: string }): Promise<KeepOutcome> {
    const now = this.now();
    if (card.action === "add") {
      const draft = edited.draft ?? card.draft!;
      const text = composeNoteText(draft);
      if (this.memory.notes().some((n) => words(n.text) === words(text))) return "duplicate";
      await this.memory.upsertNote(buildNote(draft, { now }));
      return "kept";
    }
    if (card.action === "edit") {
      const target = this.memory.getNote(card.noteId!);
      if (!target) return "gone";
      if (target.text !== card.oldText && !edited.draft) return "changed";
      await this.memory.upsertNote(buildNote(edited.draft ?? card.draft!, { id: target.id, pinned: target.pinned, now }));
      return "kept";
    }
    if (card.action === "remove") {
      const target = this.memory.getNote(card.noteId!);
      if (!target) return "gone";
      if (target.text !== card.oldText) return "changed";
      await this.memory.removeNote(target.id);
      return "kept";
    }
    const name = card.phrase!.forName?.toLowerCase();
    const tied = name ? this.memory.notes().find((n) => hasName(n.kind) && noteFields(n).name.toLowerCase() === name) : undefined;
    const tie = tied ? (tied.kind === "person" ? { partnerId: tied.id } : { placeId: tied.id }) : {};
    const made = await this.memory.addQuickPhrase(edited.phraseText ?? card.phrase!.text, tie);
    return made ? "kept" : "duplicate";
  }

  close(): void {
    this.set({ closed: true });
  }
}
