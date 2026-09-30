import { NOTE_MAX } from "@/lib/profiles/notes";
import type { ChatMessage } from "@/lib/suggest/prompt";
import { createObjectSplitter } from "@/lib/suggest/protocol";
import type { NoteKind } from "@/lib/types";
import { PROPOSALS_MAX, type LearnRequest } from "./protocol";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const KINDS: NoteKind[] = ["about-me", "person", "place", "routine", "preference"];

const pad = (n: number) => String(n).padStart(2, "0");

/** The user's local calendar date as YYYY-MM-DD. */
export function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Thursday 1 October", `days` after a YYYY-MM-DD date. Calendar arithmetic in UTC, so no time zone moves the day. */
export function longDate(iso: string, days = 0, withYear = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  const text = `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
  return withYear ? `${text} ${date.getUTCFullYear()}` : text;
}

/** Today (offset 0) and the next 14 days, as parts, for checking a date the model wrote. */
export function comingDays(today: string): { offset: number; weekday: string; day: number; month: string }[] {
  return Array.from({ length: 15 }, (_, offset) => {
    const [weekday, day, month] = longDate(today, offset).split(" ");
    return { offset, weekday, day: Number(day), month };
  });
}

/** Today and the next 14 days in full, so the model can write "Thursday" as its date. */
export function dateLine(today: string): string {
  const coming = Array.from({ length: 14 }, (_, i) => longDate(today, i + 1));
  return `Today is ${longDate(today, 0, true)}. Coming days: ${coming.join(", ")}.`;
}

function who(line: LearnRequest["lines"][number]): string {
  const name = line.speaker === "user" ? "Me" : (line.partnerName ?? "Them");
  return line.placeName ? `${name} (at ${line.placeName})` : name;
}

export function buildLearnMessages(req: LearnRequest): ChatMessage[] {
  const prompt = [
    "A person who cannot speak uses an app that suggests replies for them. Below are lines from their recent conversations and the notes the app already has about them. Suggest notes to add or change, so future replies know about new facts.",
    "",
    dateLine(req.today),
    "",
    "Notes the app has:",
    req.notes.length ? req.notes.map((n) => `${n.id} (${n.kind}): ${n.text}`).join("\n") : "(none)",
    "",
    'Conversation lines ("Me" is the person; lines from others are automatic captions and can be misheard):',
    req.lines.map((l) => `${l.id} ${who(l)}: ${l.text}`).join("\n"),
    "",
    "Rules:",
    "- Only facts the lines state. Never guess, and never add a detail that isn't in a line or a note.",
    "- Keep facts about the person and their people, places, routines, likes and dislikes, and plans with a date.",
    `- Write each note in first person as the person ("My physio is on Thursdays at 10:30."). At most ${NOTE_MAX} characters.`,
    '- Write a dated plan with its full date from the list above ("Dentist on Thursday 1 October at 3pm."), never "tomorrow" or "next week".',
    '- Write a date only when a line names the day (a weekday, today, tomorrow, or a date). Keep other time words as they were said ("end of the month").',
    "- Skip small talk, questions, guesses, jokes, and things with no later use (today's weather, what's for lunch today).",
    "- Skip anything a note already says.",
    '- If a line changes or adds to what a note says, change that note: "action": "edit", its id in "note", and the whole new text, keeping the rest of its wording.',
    "- A fact about a person or place that has a note is a change to that note, not a new note.",
    '- A change keeps every part of the old note that is still true and adds the new fact to it: "Hill Street Library is where I borrow audiobooks." becomes "Hill Street Library is where I borrow audiobooks. It is closed on Sundays now."',
    "- Leave out facts about other people unless they matter to the person (who someone is to them, when they visit).",
    "- Leave out other people's news (a friend's holiday, a child starting school) unless it changes the person's own plans.",
    "- Don't say what someone's job or role is unless a line or a note says it.",
    "- Skip a caption that doesn't make sense.",
    "- kind is one of: about-me (who they are, health, how they communicate), person (someone in their life; give their name), place (somewhere they go; give its name), routine (regular events and times), preference (likes, dislikes, usual orders).",
    `- At most ${PROPOSALS_MAX} notes, most useful first. If nothing is worth keeping, output nothing.`,
    "",
    "Output format: one JSON object per line and nothing else. No markdown.",
    '{"action": "add", "kind": "person", "name": "Ana", "text": "Ana is my new carer. She comes on weekday mornings.", "lines": ["L1"]}',
    '{"action": "edit", "note": "N2", "kind": "routine", "text": "I have physio on Thursdays at 10:30.", "lines": ["L4"]}',
  ].join("\n");
  return [
    { role: "system", content: "You keep short notes about a person up to date from their conversations. Follow the output format exactly." },
    { role: "user", content: prompt },
  ];
}

export interface RawProposal {
  action: "add" | "edit";
  kind: NoteKind;
  name?: string;
  text: string;
  /** The note id an edit changes, as the model saw it. */
  note?: string;
  /** Line ids as the model saw them. */
  lines: string[];
}

/** Proposals in the model's output, however it is laid out. Malformed ones are skipped, never repaired. */
export function parseProposals(output: string): RawProposal[] {
  const found: RawProposal[] = [];
  const splitter = createObjectSplitter((json) => {
    if (found.length >= PROPOSALS_MAX) return;
    let item: unknown;
    try {
      item = JSON.parse(json);
    } catch {
      return;
    }
    if (!item || typeof item !== "object") return;
    const { action, kind, name, text, note, lines } = item as Record<string, unknown>;
    if (action !== "add" && action !== "edit") return;
    if (!KINDS.includes(kind as NoteKind)) return;
    if (typeof text !== "string" || !text.trim() || text.trim().length > NOTE_MAX) return;
    if (!Array.isArray(lines) || lines.length === 0 || !lines.every((l) => typeof l === "string")) return;
    if (action === "edit" && typeof note !== "string") return;
    found.push({
      action,
      kind: kind as NoteKind,
      ...(typeof name === "string" && name.trim() ? { name: name.trim().slice(0, 60) } : {}),
      text: text.trim(),
      ...(action === "edit" ? { note: note as string } : {}),
      lines: lines as string[],
    });
  });
  splitter.push(output);
  splitter.flush();
  return found;
}
