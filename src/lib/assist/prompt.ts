import { dateLine } from "@/lib/learning/prompt";
import { NOTE_MAX } from "@/lib/profiles/notes";
import type { ChatMessage } from "@/lib/suggest/prompt";
import type { NoteKind } from "@/lib/types";
import { ASSIST_PROPOSALS_MAX, ASSIST_SAY_MAX, PHRASE_MAX, type AssistJob, type AssistRequest } from "./protocol";

const KINDS: NoteKind[] = ["about-me", "person", "place", "routine", "preference"];

const JOBS: Record<AssistJob, string> = {
  update:
    "Job: update their information. Ask what has changed, or offer to go through one group of notes with them (people, places, routines, likes). Propose adds, edits and removals.",
  prepare:
    "Job: prepare for an appointment. Find out, one question at a time: who it is with, when, where, what it is about, and what they want to say or ask. Then propose a dated note, a person or place note if their notes have none for them, and 3 to 5 quick phrases for that person or place.",
  phrases:
    "Job: make quick phrases. Ask who or where the phrases are for and what they often need to say there. Then propose 3 to 5 phrases.",
};

const NO_JOB =
  "No job picked yet. Work out which of these fits what they typed and say so: update their information, prepare for an appointment, make quick phrases. For anything else, say briefly what you can help with.";

export function buildAssistMessages(req: AssistRequest): ChatMessage[] {
  const prompt = [
    "A person who cannot speak uses an app that suggests replies for them, built from short notes about them. They are typing to you, the app's assistant. Typing is slow for them, so keep each message short and ask one question at a time.",
    "",
    req.job ? JOBS[req.job] : NO_JOB,
    "",
    dateLine(req.today),
    "",
    "Their notes:",
    req.notes.length ? req.notes.map((n) => `${n.id} (${n.kind}): ${n.text}`).join("\n") : "(none)",
    "",
    "Their quick phrases:",
    req.phrases.length ? req.phrases.map((p) => `${p.id}: "${p.text}"${p.for ? ` (for ${p.for})` : ""}`).join("\n") : "(none)",
    "",
    "Chat so far:",
    req.lines
      .map((l) =>
        l.speaker === "user" ? `${l.id} Me: ${l.text}` : `${l.id} You: ${l.text}${l.proposed?.length ? ` (You proposed: ${l.proposed.join("; ")})` : ""}`,
      )
      .join("\n"),
    "",
    "Rules:",
    "- Propose a change only for something the person said in their own lines (U lines). Never use a detail from your own lines, and never guess.",
    '- List the U lines each proposal comes from in "lines".',
    `- Notes are in first person as the person, at most ${NOTE_MAX} characters. kind is one of: about-me (who they are, health, how they communicate), person (give their name), place (give its name), routine (regular or dated events), preference (likes, dislikes, usual orders).`,
    '- A change to what a note says is an edit of that note: "action": "edit", its id in "note", and the whole new text, keeping every part that is still true.',
    '- Remove a note ("action": "remove") only when they say it is no longer true or ask you to.',
    '- Write a dated plan with its full date from the list above ("Thursday 8 October, 10:00: seeing Dr. Chen at Lakeview Clinic about my blood pressure."). Write a date only when they named the day. For a day further away than the list, ask them to type the date, and write it as they typed it.',
    `- Quick phrases are things they can say with one tap, in their own voice, at most ${PHRASE_MAX} characters, with no detail they haven't told you. "for" is the name of the person or place a phrase is for; leave it out for a phrase for anyone.`,
    "- Don't propose what a note or quick phrase already says, or anything you proposed before.",
    "- When you have what you need, propose the changes and ask if there is anything else. When they say that's all, say goodbye briefly and propose nothing.",
    `- "say" is plain text, at most ${ASSIST_SAY_MAX} characters, no lists or markdown.`,
    `- At most ${ASSIST_PROPOSALS_MAX} proposals in one answer.`,
    "",
    "Output format: one JSON object and nothing else. No markdown.",
    '{"say": "Here is a note and three phrases. Anything else?", "proposals": [',
    '  {"action": "add", "kind": "routine", "text": "Thursday 8 October, 10:00: seeing Dr. Chen at Lakeview Clinic about my blood pressure.", "lines": ["U2", "U3"]},',
    '  {"action": "edit", "note": "N2", "kind": "routine", "text": "I have physio on Thursdays at 10:30.", "lines": ["U4"]},',
    '  {"action": "remove", "note": "N5", "lines": ["U5"]},',
    '  {"action": "phrase", "text": "Can we go over my dose?", "for": "Dr. Chen", "lines": ["U3"]}',
    "]}",
    '{"say": "Who is the appointment with?", "proposals": []}',
  ].join("\n");
  return [
    { role: "system", content: "You are a careful assistant that keeps a person's notes and phrases up to date. Follow the output format exactly." },
    { role: "user", content: prompt },
  ];
}

export interface RawAssistProposal {
  action: "add" | "edit" | "remove" | "phrase";
  kind?: NoteKind;
  name?: string;
  text?: string;
  /** The note id an edit or removal targets, as the model saw it. */
  note?: string;
  for?: string;
  /** Line ids as the model saw them. */
  lines: string[];
}

/** Cuts a message at the last sentence end within the limit, or at the limit. */
export function clipSay(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= ASSIST_SAY_MAX) return t;
  const cut = t.slice(0, ASSIST_SAY_MAX);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > 0 ? cut.slice(0, end + 1) : cut.trim();
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function readProposal(item: unknown): RawAssistProposal | null {
  if (!item || typeof item !== "object") return null;
  const { action, kind, name, text, note, lines } = item as Record<string, unknown>;
  const forName = str((item as Record<string, unknown>).for);
  if (!Array.isArray(lines) || lines.length === 0 || !lines.every((l) => typeof l === "string")) return null;
  const ids = lines as string[];
  if (action === "remove") return str(note) ? { action, note: str(note), lines: ids } : null;
  const body = str(text);
  if (!body) return null;
  if (action === "phrase") return body.length <= PHRASE_MAX ? { action, text: body, ...(forName ? { for: forName.slice(0, 80) } : {}), lines: ids } : null;
  if (action !== "add" && action !== "edit") return null;
  if (!KINDS.includes(kind as NoteKind) || body.length > NOTE_MAX) return null;
  if (action === "edit" && !str(note)) return null;
  const n = str(name);
  return { action, kind: kind as NoteKind, ...(n ? { name: n.slice(0, 60) } : {}), text: body, ...(action === "edit" ? { note: str(note) } : {}), lines: ids };
}

/** The model's answer, however it is wrapped. Null when there is no readable object with a message. */
export function parseAssistOutput(output: string): { say: string; proposals: RawAssistProposal[] } | null {
  const text = output.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const say = str((data as { say?: unknown }).say);
  if (!say) return null;
  const list = (data as { proposals?: unknown }).proposals;
  const proposals = (Array.isArray(list) ? list : []).map(readProposal).filter((p): p is RawAssistProposal => p !== null);
  return { say: clipSay(say), proposals: proposals.slice(0, ASSIST_PROPOSALS_MAX) };
}
