import type { ChatMessage } from "@/lib/suggest/prompt";
import type { NoteKind } from "@/lib/types";
import { hasName, NOTE_MAX, type DraftNote } from "./notes";

export const DOCUMENT_NOTES_MAX = 40;
const KINDS: NoteKind[] = ["about-me", "person", "place", "routine", "preference"];

export function buildDocumentMessages(text: string): ChatMessage[] {
  const prompt = [
    "A person who cannot speak uses an app that suggests replies for them in conversations. They have shared a document about themselves. Turn it into short notes the app can use.",
    "",
    "Rules:",
    '- One fact per note, written in first person as the person ("My daughter Leila studies in Toronto.").',
    `- At most ${NOTE_MAX} characters per note. Plain words.`,
    "- Only facts the document states. Never guess or add anything.",
    "- kind is one of: about-me (who they are, health, how they communicate), person (someone in their life; give their name), place (somewhere they go; give its name), routine (regular events and times), preference (likes, dislikes, usual orders).",
    "- Leave out other people's private details that aren't needed to talk with them.",
    `- At most ${DOCUMENT_NOTES_MAX} notes, most useful first.`,
    "",
    "Output format: one JSON object per line and nothing else. No markdown.",
    '{"kind": "person", "name": "Leila", "text": "Leila is my daughter. She studies in Toronto."}',
    '{"kind": "routine", "text": "I have physio on Tuesdays at 10:30."}',
    "",
    "The document:",
    '"""',
    text,
    '"""',
  ].join("\n");
  return [
    { role: "system", content: "You turn documents into short first-person notes. Follow the output format exactly." },
    { role: "user", content: prompt },
  ];
}

/** One note per JSON line; anything else (markdown fences, bad kinds, empty text) is skipped. */
export function parseDocumentNotes(output: string): DraftNote[] {
  const notes: DraftNote[] = [];
  for (const line of output.split("\n")) {
    if (notes.length >= DOCUMENT_NOTES_MAX) break;
    const start = line.indexOf("{");
    const end = line.lastIndexOf("}");
    if (start < 0 || end < start) continue;
    let item: unknown;
    try {
      item = JSON.parse(line.slice(start, end + 1));
    } catch {
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const { kind, name, text } = item as Record<string, unknown>;
    if (!KINDS.includes(kind as NoteKind) || typeof text !== "string" || !text.trim()) continue;
    const note: DraftNote = { kind: kind as NoteKind, text: text.trim().slice(0, NOTE_MAX) };
    if (hasName(note.kind) && typeof name === "string" && name.trim()) note.name = name.trim().slice(0, 60);
    notes.push(note);
  }
  return notes;
}
