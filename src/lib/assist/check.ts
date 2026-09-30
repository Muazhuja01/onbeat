import { checkProposals } from "@/lib/learning/check";
import type { LearnRequest, Proposal } from "@/lib/learning/protocol";
import { claimSupported, extractClaims, isNearDuplicate } from "@/lib/suggest/validate";
import { PHRASE_MAX, type AssistProposal, type AssistRequest } from "./protocol";

type NoteProposal = Extract<AssistProposal, { action: "add" | "edit" }>;

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";

/**
 * A note's text with each 24-hour time that its cited lines typed as am/pm written back in
 * that form, so "2 pm" backs "14:00". The model writes dated notes in 24-hour time. Only the
 * note is rewritten, and only a time, so a line's "2 pm" never backs a bare "14" ("room 14").
 */
export function withTypedTimes(text: string, lineText: string): string {
  const typed = new Map<string, string>();
  for (const m of lineText.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?![\p{L}])/giu)) {
    const hour = Number(m[1]);
    if (hour < 1 || hour > 12) continue;
    const ap = m[3].toLowerCase();
    const minutes = m[2] ?? "00";
    typed.set(`${(hour % 12) + (ap === "p" ? 12 : 0)}:${minutes}`, `${hour}:${minutes} ${ap}m`);
  }
  if (!typed.size) return text;
  return text.replace(/\b(\d{1,2}):(\d{2})\b/g, (time, h: string, min: string) => typed.get(`${Number(h)}:${min}`) ?? time);
}

/**
 * A note's text without the dates ("3 November") that its cited lines state as typed, day and
 * month alike, so the learning check doesn't drop a date past the coming two weeks that the
 * person typed themselves (the prompt asks for such a date). Every other part is still checked.
 */
function withoutTypedDates(text: string, lineText: string): string {
  return text.replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS})\\b`, "gi"), (date, day: string, month: string) => {
    const typed = new RegExp(`\\b(?:${day}(?:st|nd|rd|th)?\\s+${month}|${month}\\s+${day}(?:st|nd|rd|th)?)\\b`, "i");
    return typed.test(lineText) ? " " : date;
  });
}

/**
 * Drops, never repairs. Every proposal must cite only the user's own lines: the assistant's
 * lines are its own words and can't be the source of a fact. Note adds and edits then pass
 * the learning check (a detail must be in the cited lines, or the old note for an edit), with
 * two allowances: an am/pm time a line states backs its 24-hour form, and a date a cited
 * line states as typed may be past the coming two weeks.
 * A removal must name a sent note that isn't also edited. A phrase may not state a name or
 * number found in no user line and no sent note, and may not repeat a quick phrase.
 */
export function checkAssistProposals(proposals: AssistProposal[], req: AssistRequest): AssistProposal[] {
  const userLines = req.lines.filter((l) => l.speaker === "user");
  const userIds = new Set(userLines.map((l) => l.id));
  const cited = proposals.filter((p) => p.lineIds.length > 0 && p.lineIds.every((id) => userIds.has(id)));

  const learnReq: LearnRequest = {
    today: req.today,
    lines: userLines.map((l) => ({ id: l.id, speaker: "user" as const, text: l.text })),
    notes: req.notes,
  };
  const lineText = new Map(userLines.map((l) => [l.id, l.text]));
  const noteProposals = cited.filter((p): p is NoteProposal => p.action === "add" || p.action === "edit");
  // The check sees each text without its typed dates and with its times as typed; what it
  // keeps is shown as the model wrote it.
  const shown = new Map<string, string>();
  const checkedText = (p: NoteProposal) => {
    const said = p.lineIds.map((id) => lineText.get(id) ?? "").join("\n");
    const t = withTypedTimes(withoutTypedDates(p.text, said), said);
    if (!shown.has(t)) shown.set(t, p.text);
    return t;
  };
  const notes: AssistProposal[] = checkProposals(
    noteProposals.map((p): Proposal => ({ action: p.action, kind: p.kind, ...(p.name ? { name: p.name } : {}), text: checkedText(p), ...(p.action === "edit" ? { noteId: p.noteId } : {}), lineIds: p.lineIds })),
    learnReq,
  ).map((p) =>
    p.action === "edit"
      ? { action: "edit", kind: p.kind, ...(p.name ? { name: p.name } : {}), text: shown.get(p.text)!, noteId: p.noteId!, lineIds: p.lineIds }
      : { action: "add", kind: p.kind, ...(p.name ? { name: p.name } : {}), text: shown.get(p.text)!, lineIds: p.lineIds },
  );

  const sent = new Set(req.notes.map((n) => n.id));
  const edited = new Set(notes.flatMap((p) => (p.action === "edit" ? [p.noteId] : [])));
  const removals: AssistProposal[] = [];
  for (const p of cited) {
    if (p.action !== "remove") continue;
    if (!sent.has(p.noteId) || edited.has(p.noteId) || removals.some((r) => r.action === "remove" && r.noteId === p.noteId)) continue;
    removals.push(p);
  }

  const sources = [...userLines.map((l) => l.text), ...req.notes.map((n) => n.text)].join("\n");
  const phraseTexts = req.phrases.map((p) => p.text);
  const phrases: AssistProposal[] = [];
  for (const p of cited) {
    if (p.action !== "phrase") continue;
    const text = p.text.trim();
    if (!text || text.length > PHRASE_MAX) continue;
    if (p.for && !claimSupported(p.for, sources)) continue;
    if (!extractClaims(text).every((claim) => claimSupported(claim, sources))) continue;
    if (phraseTexts.some((t) => isNearDuplicate(text, t))) continue;
    phraseTexts.push(text);
    phrases.push({ ...p, text });
  }

  return [...notes, ...removals, ...phrases];
}
