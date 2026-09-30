import { personas } from "@/data/personas";
import type { AssistCard } from "@/lib/assist/session";
import { dateLine } from "@/lib/learning/prompt";
import { composeNoteText } from "@/lib/profiles/notes";
import type { ChatMessage } from "@/lib/suggest/prompt";
import type { AssistCase, ExpectedChange } from "./cases";

/** Bump when the prompt below changes, so cached verdicts aren't reused. */
export const ASSIST_JUDGE_VERSION = 2;

export interface ShownCard {
  action: "add" | "edit" | "remove" | "phrase";
  text: string;
  oldText?: string;
  forName?: string;
}
export interface AssistJudgeInput {
  today: string;
  brief: string;
  notes: string[];
  lines: { speaker: "user" | "assistant"; text: string }[];
  expected: ExpectedChange[];
  cards: ShownCard[];
}
export interface CardVerdict {
  n: number;
  keep: boolean;
  invented: string[];
  matches: number | null;
  sayable: boolean | null;
}
export interface AssistVerdict {
  cards: CardVerdict[];
  leak: boolean;
}

/**
 * What the app had before the chat: the persona's notes, then the quick phrases the case starts
 * with, so the judge can tell a phrase the person already has from a new one.
 */
export function judgeNotes(c: AssistCase): string[] {
  const notes = personas.find((p) => p.id === c.persona)!.notes;
  const phrases = (c.quick ?? []).map(([text, tied]) => {
    const name = tied ? notes.find((n) => n.id === tied)?.entities[0] : undefined;
    return `Quick phrase${name ? ` for ${name}` : ""}: "${text}"`;
  });
  return [...notes.map((n) => n.text), ...phrases];
}

/** A card as the user sees it: notes as they would be saved, a removal as the note it removes. The note id stays for scoring. */
export function shownCard(card: AssistCard): ShownCard & { noteId?: string } {
  const noteId = card.noteId ? { noteId: card.noteId } : {};
  if (card.action === "add") return { action: "add", text: composeNoteText(card.draft!) };
  if (card.action === "edit") return { action: "edit", text: composeNoteText(card.draft!), oldText: card.oldText ?? "", ...noteId };
  if (card.action === "remove") return { action: "remove", text: card.oldText ?? "", ...noteId };
  return { action: "phrase", text: card.phrase!.text, ...(card.phrase!.forName ? { forName: card.phrase!.forName } : {}) };
}

const cardLine = (c: ShownCard, i: number) => {
  const n = i + 1;
  if (c.action === "edit") return `${n}. [change note] "${c.oldText ?? ""}" -> "${c.text}"`;
  if (c.action === "remove") return `${n}. [remove note] "${c.text}"`;
  if (c.action === "phrase") return `${n}. [quick phrase${c.forName ? ` for ${c.forName}` : ""}] "${c.text}"`;
  return `${n}. [new note] "${c.text}"`;
};

export function assistJudgeMessages(j: AssistJudgeInput): ChatMessage[] {
  const content = [
    "A person who cannot speak uses an app that suggests replies built from notes about them, and quick phrases they can say with one tap. They chatted with the app's assistant, which proposed changes. Judge each proposal, and check the person's own messages.",
    "",
    dateLine(j.today),
    "",
    "What the person wanted and knew (their brief):",
    j.brief,
    "",
    "Notes the app had:",
    j.notes.length ? j.notes.map((n) => `- ${n}`).join("\n") : "(none)",
    "",
    "The chat (Me is the person):",
    j.lines.map((l) => `- ${l.speaker === "user" ? "Me" : "Assistant"}: ${l.text}`).join("\n"),
    "",
    "Changes a careful helper would have proposed:",
    j.expected.length ? j.expected.map((e, i) => `${i + 1}. [${e.action}] ${e.fact}`).join("\n") : "(none: nothing should change)",
    "",
    "Proposals:",
    j.cards.length ? j.cards.map(cardLine).join("\n") : "(none)",
    "",
    "For each proposal:",
    "- keep: true if it is true to what the person said and worth saving. For a change, also false if it drops something the old note said that is still true. For a removal, true only if the person said the note is no longer true or asked for it to go.",
    "- invented: every detail (name, number, time, date, place, claim) in it found in none of the person's messages, the notes, or the date list. A detail that follows from today's date or the date list is not invented (a weekday for a date the person gave, or the month for \"next month\"). [] if none.",
    "- matches: the number of the listed change it makes, or null.",
    "- sayable: for a quick phrase, true if the person could say it as it is, in their own voice, in that setting; null for anything else.",
    "Also: leak is true if any of the person's messages states a fact that is not in their brief.",
    "",
    'Reply with JSON only: {"leak": false, "cards": [{"n": 1, "keep": true, "invented": [], "matches": 1, "sayable": null}]}',
  ].join("\n");
  return [
    { role: "system", content: "You check an assistant's proposals against a chat. Be strict about invented details. Answer with JSON only." },
    { role: "user", content },
  ];
}

export function parseAssistVerdict(text: string, count: number): AssistVerdict | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const { cards: list, leak } = data as { cards?: unknown; leak?: unknown };
  if (!Array.isArray(list) || typeof leak !== "boolean") return null;
  const cards: CardVerdict[] = [];
  for (let n = 1; n <= count; n++) {
    const v = list.find((x) => (x as { n?: unknown })?.n === n) as Record<string, unknown> | undefined;
    if (!v || typeof v.keep !== "boolean" || !Array.isArray(v.invented)) return null;
    cards.push({ n, keep: v.keep, invented: v.invented.map(String), matches: typeof v.matches === "number" ? v.matches : null, sayable: typeof v.sayable === "boolean" ? v.sayable : null });
  }
  return { cards, leak };
}

const majority = (xs: boolean[]) => xs.filter(Boolean).length * 2 > xs.length;

/** Majority per card and for the leak flag, over the readable calls. */
export function voteAssist(sets: (AssistVerdict | null)[]): AssistVerdict | null {
  const readable = sets.filter((s): s is AssistVerdict => s !== null);
  if (readable.length === 0) return null;
  const cards = readable[0].cards.map((_, i) => {
    const calls = readable.map((s) => s.cards[i]);
    const inventedCalls = calls.filter((c) => c.invented.length > 0);
    const counts = new Map<number | null, number>();
    for (const c of calls) counts.set(c.matches, (counts.get(c.matches) ?? 0) + 1);
    const sayableCalls = calls.map((c) => c.sayable).filter((s): s is boolean => s !== null);
    return {
      n: i + 1,
      keep: majority(calls.map((c) => c.keep)),
      invented: majority(calls.map((c) => c.invented.length > 0)) ? inventedCalls[0].invented : [],
      matches: [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0],
      sayable: sayableCalls.length ? majority(sayableCalls) : null,
    };
  });
  return { cards, leak: majority(readable.map((s) => s.leak)) };
}
