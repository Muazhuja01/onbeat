import { dateLine } from "@/lib/learning/prompt";
import type { Speaker } from "@/lib/learning/types";
import type { ChatMessage } from "@/lib/suggest/prompt";

/** Bump when the prompt below changes, so old cached verdicts aren't reused. */
export const LEARN_JUDGE_VERSION = 1;

export interface ShownSuggestion {
  action: "add" | "edit";
  text: string;
  oldText?: string;
  noteId?: string;
}

export interface LearnJudgeInput {
  today: string;
  lines: { speaker: Speaker; text: string; partnerName?: string }[];
  /** Texts of the notes the app had. */
  notes: string[];
  expected: { action: "add" | "edit"; fact: string; oldText?: string }[];
  shown: ShownSuggestion[];
}

export interface LearnVerdict {
  n: number;
  keep: boolean;
  invented: string[];
  matches: number | null;
}

export function learnJudgeMessages(j: LearnJudgeInput): ChatMessage[] {
  const content = [
    "A person who cannot speak uses an app that suggests replies built from notes about them. After a conversation the app suggested new notes, or changes to notes. Judge each suggestion.",
    "",
    dateLine(j.today),
    "",
    'Conversation ("Me" is the person; other lines are automatic captions and may contain errors):',
    j.lines.map((l) => `- ${l.speaker === "user" ? "Me" : (l.partnerName ?? "Them")}: ${l.text}`).join("\n"),
    "",
    "Notes the app already had:",
    j.notes.length ? j.notes.map((n) => `- ${n}`).join("\n") : "(none)",
    "",
    "Facts a careful helper would have noted:",
    j.expected.length
      ? j.expected.map((e, i) => `${i + 1}. ${e.action === "edit" ? `[change to: "${e.oldText ?? ""}"]` : "[new note]"} ${e.fact}`).join("\n")
      : "(none: nothing here is worth a note)",
    "",
    "Suggestions:",
    j.shown.map((s, i) => `${i + 1}. ${s.action === "edit" ? `[change] "${s.oldText ?? ""}" -> "${s.text}"` : `[new note] "${s.text}"`}`).join("\n"),
    "",
    "For each suggestion:",
    "- keep: true if it is true to the conversation and worth saving for future replies: a fact about the person, their people, places, routines or likes, or a dated plan. False for small talk, guesses, a misheard caption taken literally, facts about other people that don't matter to the person, or something the notes already say. For a change, also false if the new text drops something the old note said that is still true.",
    '- invented: every detail (name, number, time, date, place, claim) in the suggestion found in none of the conversation, the notes, or the date list. Writing "Thursday" as its date from the list is not invented. [] if none.',
    "- matches: the number of the listed fact it records, or null.",
    "",
    'Reply with JSON only: {"suggestions": [{"n": 1, "keep": true, "invented": [], "matches": 1}]}',
  ].join("\n");
  return [
    { role: "system", content: "You check suggested notes against a conversation. Be strict about invented details. Answer with JSON only." },
    { role: "user", content },
  ];
}

export function parseLearnVerdicts(text: string, count: number): LearnVerdict[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = (data as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(list)) return null;
  const verdicts: LearnVerdict[] = [];
  for (let n = 1; n <= count; n++) {
    const v = list.find((x) => (x as { n?: unknown })?.n === n) as Record<string, unknown> | undefined;
    if (!v || typeof v.keep !== "boolean" || !Array.isArray(v.invented)) return null;
    const matches = typeof v.matches === "number" ? v.matches : null;
    verdicts.push({ n, keep: v.keep, invented: v.invented.map(String), matches });
  }
  return verdicts;
}

/** Majority per suggestion over the readable calls: keep, whether anything is invented, and the most common match. */
export function voteLearn(sets: (LearnVerdict[] | null)[]): LearnVerdict[] | null {
  const readable = sets.filter((s): s is LearnVerdict[] => s !== null);
  if (readable.length === 0) return null;
  return readable[0].map((_, i) => {
    const calls = readable.map((s) => s[i]);
    const keep = calls.filter((c) => c.keep).length * 2 > calls.length;
    const inventedCalls = calls.filter((c) => c.invented.length > 0);
    const invented = inventedCalls.length * 2 > calls.length ? inventedCalls[0].invented : [];
    const counts = new Map<number | null, number>();
    for (const c of calls) counts.set(c.matches, (counts.get(c.matches) ?? 0) + 1);
    const matches = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { n: i + 1, keep, invented, matches };
  });
}
