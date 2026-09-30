import { checkProposals } from "@/lib/learning/check";
import type { LearnRequest, Proposal } from "@/lib/learning/protocol";
import { claimSupported, extractClaims, isNearDuplicate } from "@/lib/suggest/validate";
import { PHRASE_MAX, type AssistProposal, type AssistRequest } from "./protocol";

type NoteProposal = Extract<AssistProposal, { action: "add" | "edit" }>;

/**
 * Drops, never repairs. Every proposal must cite only the user's own lines: the assistant's
 * lines are its own words and can't be the source of a fact. Note adds and edits then pass
 * the learning check (a detail must be in the cited lines, or the old note for an edit).
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
  const noteProposals = cited.filter((p): p is NoteProposal => p.action === "add" || p.action === "edit");
  const notes: AssistProposal[] = checkProposals(
    noteProposals.map((p): Proposal => ({ action: p.action, kind: p.kind, ...(p.name ? { name: p.name } : {}), text: p.text, ...(p.action === "edit" ? { noteId: p.noteId } : {}), lineIds: p.lineIds })),
    learnReq,
  ).map((p) =>
    p.action === "edit"
      ? { action: "edit", kind: p.kind, ...(p.name ? { name: p.name } : {}), text: p.text, noteId: p.noteId!, lineIds: p.lineIds }
      : { action: "add", kind: p.kind, ...(p.name ? { name: p.name } : {}), text: p.text, lineIds: p.lineIds },
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
