import { composeNoteText } from "@/lib/profiles/notes";
import { claimSupported, extractClaims, isNearDuplicate } from "@/lib/suggest/validate";
import { tokenize } from "@/lib/text";
import { comingDays } from "./prompt";
import type { LearnRequest, Proposal } from "./protocol";

/** "9:00" says no more than "9", which a line saying "nine" backs; "9:30" still needs its digits.
 * "AM"/"PM" in capitals would be checked as a name; written lowercase ("3pm") they never were.
 * Applied to the note and to the lines it cites, so "10:00" in both still matches. */
const plainTimes = (t: string) => t.replace(/\b(\d{1,2}):00\b/g, "$1").replace(/\b([AP])\.?M\.?(?![\p{L}])/gu, (m) => m.toLowerCase());

const sameWords = (a: string, b: string) => tokenize(a).join(" ") === tokenize(b).join(" ");

/** A day and month, as in "22 October"; any left after the coming days are taken out is one the model made up. */
const ANY_DATE = /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i;

/**
 * Takes out the full dates ("Thursday 1 October", "1 October") a model wrote for a day its
 * lines named. Null when a date isn't one of the coming days, or no cited line names it
 * (its weekday, or "tomorrow"/"today"/"tonight" for those days).
 */
function withoutNamedDates(text: string, lineText: string, today: string): string | null {
  const said = lineText.toLowerCase();
  let rest = text;
  for (const d of comingDays(today)) {
    const date = new RegExp(`\\b(?:${d.weekday}\\s+)?${d.day}(?:st|nd|rd|th)?\\s+${d.month}\\b`, "gi");
    if (!date.test(rest)) continue;
    const named =
      said.includes(d.weekday.toLowerCase()) || (d.offset === 1 && /\btomorrow\b/.test(said)) || (d.offset === 0 && /\b(?:today|tonight)\b/.test(said));
    if (!named) return null;
    rest = rest.replace(date, " ");
  }
  return ANY_DATE.test(rest) ? null : rest;
}

/**
 * Drops, never repairs, a proposal that cites no line or one that wasn't sent; edits a
 * note that wasn't sent, or into the same words; repeats a sent note or an earlier
 * proposal; writes a date its lines don't name; or states a detail (name, number, time,
 * day) found in none of its cited lines and, for an edit, the note it changes. Only the
 * first edit of each note stays.
 */
export function checkProposals(proposals: Proposal[], req: LearnRequest): Proposal[] {
  const lines = new Map(req.lines.map((l) => [l.id, l]));
  const notes = new Map(req.notes.map((n) => [n.id, n.text]));
  const kinds = new Map(req.notes.map((n) => [n.id, n.kind]));
  const kept: Proposal[] = [];
  const keptTexts: string[] = [];

  for (const raw of proposals) {
    // An edit is checked, and shown, as the kind of note it changes; otherwise a name the
    // model adds to a person note would never be checked.
    const p: Proposal = raw.action === "edit" ? { ...raw, kind: kinds.get(raw.noteId ?? "") ?? raw.kind } : raw;
    if (p.lineIds.length === 0 || !p.lineIds.every((id) => lines.has(id))) continue;
    const text = composeNoteText({ kind: p.kind, name: p.name, text: p.text });
    if (!text) continue;

    if (p.action === "edit") {
      const oldText = notes.get(p.noteId ?? "");
      if (oldText === undefined || sameWords(text, oldText)) continue;
      if (kept.some((k) => k.action === "edit" && k.noteId === p.noteId)) continue;
    } else if ([...notes.values(), ...keptTexts].some((t) => isNearDuplicate(text, t))) {
      continue;
    }

    const cited = p.lineIds.map((id) => {
      const l = lines.get(id)!;
      return [l.text, l.partnerName ?? "", l.placeName ?? ""].join("\n");
    });
    const dated = withoutNamedDates(text, cited.join("\n"), req.today);
    if (dated === null) continue;
    const checked = plainTimes(dated);
    // Spec decision 10: the cited lines, plus the old note for an edit. Other sent notes are
    // no source, or a new note could borrow an unrelated note's time or name.
    const sources = plainTimes([...cited, ...(p.action === "edit" ? [notes.get(p.noteId ?? "") ?? ""] : [])].join("\n"));
    if (!extractClaims(checked).every((claim) => claimSupported(claim, sources))) continue;

    kept.push(
      p.action === "edit" ? p : { action: "add", kind: p.kind, ...(p.name ? { name: p.name } : {}), text: p.text, lineIds: p.lineIds },
    );
    keptTexts.push(text);
  }
  return kept;
}
