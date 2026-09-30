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

/** Roles and relationships a note or phrase can claim for someone; each group backs itself. */
const ROLE_GROUPS: string[][] = [
  ["doctor", "gp", "physician"],
  ["dentist"],
  ["pharmacist", "chemist"],
  ["nurse"],
  ["optician", "optometrist"],
  ["physio", "physiotherapist"],
  ["therapist", "counsellor", "counselor"],
  ["specialist", "consultant", "surgeon"],
  ["vet"],
  ["neighbour", "neighbor"],
  ["manager", "boss", "supervisor"],
  ["carer", "caregiver", "care worker", "support worker", "aide"],
  ["colleague", "coworker", "co-worker", "teammate"],
  ["landlord", "landlady"],
  ["teacher", "tutor"],
  ["friend", "best friend"],
  ["partner", "husband", "wife", "boyfriend", "girlfriend"],
  ["mum", "mom", "mother"],
  ["dad", "father"],
  ["sister"],
  ["brother"],
  ["son"],
  ["daughter"],
  ["aunt"],
  ["uncle"],
  ["cousin"],
  ["grandma", "grandmother", "nan", "gran"],
  ["grandpa", "grandfather", "grandad"],
];
const ROLE_WORDS = ROLE_GROUPS.flat().sort((a, b) => b.length - a.length);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const roleAlt = ROLE_WORDS.map((w) => escapeRe(w).replace(/[\s-]+/g, "[\\s-]+")).join("|");
/** "my doctor", "our new neighbour", "my family doctor": up to two words between "my" and the role. */
const ROLE_CLAIM = new RegExp(
  `\\b(?:my|our)\\s+(?:(?!(?:a|an|the|with|at|for|to|from|and|of|about|in|on)\\b)[\\p{L}'-]+\\s+){0,2}?(${roleAlt})s?\\b`,
  "giu",
);

/**
 * The roles or relationships ("my doctor", "my neighbour") a text claims for someone that no
 * source states. A source states a role when it has the role word, or another in its group
 * ("GP" backs "my doctor"), anywhere; "Dr." alone does not.
 */
export function unbackedRoles(text: string, source: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(ROLE_CLAIM)) {
    const word = m[1].toLowerCase().replace(/[\s-]+/g, " ");
    const group = ROLE_GROUPS.find((g) => g.some((w) => w.replace(/-/g, " ") === word)) ?? [word];
    const stated = group.some((w) => new RegExp(`\\b${escapeRe(w).replace(/[\s-]+/g, "[\\s-]+")}s?\\b`, "iu").test(source));
    if (!stated) out.push(m[0]);
  }
  return out;
}

/** Words that say a thing ended or ask for a note to go; a removal needs one in a cited line. */
const ENDED =
  /\b(?:remov(?:e|ed|es|ing)|delet(?:e|ed|es|ing)|get rid|take (?:it|that|this) (?:off|out)|forget|gone|left|leaving|leaves|no longer|any ?more|no more|died|dead|passed away|stop(?:ped|s)?|finish(?:ed|es)?|ended|over now|closed|closing|shut|cancel(?:l?ed|s)?|called off|(?:is|it's|its|was) off|quit|retired|moved (?:away|out)|broke up|split up|sold|not true|isn't true|not happening)\b/i;

const DAY_OR_MONTH = new RegExp(`^(?:(?:mon|tues|wednes|thurs|fri|satur|sun)days?|${MONTHS})$`, "i");

/** The names a text states (capitalised words, not days or months), lowercased, in order. */
function namesIn(text: string): string[] {
  return extractClaims(text)
    .filter((c) => /^\p{Lu}/u.test(c) && !DAY_OR_MONTH.test(c))
    .map((c) => c.toLowerCase());
}

/**
 * Drops, never repairs. Every proposal must cite only the user's own lines: the assistant's
 * lines are its own words and can't be the source of a fact. Note adds and edits then pass
 * the learning check (a detail must be in the cited lines, or the old note for an edit), with
 * two allowances: an am/pm time a line states backs its 24-hour form, and a date a cited
 * line states as typed may be past the coming two weeks. A note may not claim a role or
 * relationship ("my doctor") that no cited line and not the note it edits states; a phrase may
 * not claim one that no cited line and no sent note states.
 * A removal must name a sent note that isn't also edited, cite a line that says the thing
 * ended or asks for the note to go, and not come with a new person or place note about a name
 * the removed note has (that is an edit). A phrase may not state a name or
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
  const saidBy = (p: AssistProposal) => p.lineIds.map((id) => lineText.get(id) ?? "").join("\n");
  const oldText = new Map(req.notes.map((n) => [n.id, n.text]));
  const notes: AssistProposal[] = checkProposals(
    noteProposals.map((p): Proposal => ({ action: p.action, kind: p.kind, ...(p.name ? { name: p.name } : {}), text: checkedText(p), ...(p.action === "edit" ? { noteId: p.noteId } : {}), lineIds: p.lineIds })),
    learnReq,
  )
    .map(
      (p): NoteProposal =>
        p.action === "edit"
          ? { action: "edit", kind: p.kind, ...(p.name ? { name: p.name } : {}), text: shown.get(p.text)!, noteId: p.noteId!, lineIds: p.lineIds }
          : { action: "add", kind: p.kind, ...(p.name ? { name: p.name } : {}), text: shown.get(p.text)!, lineIds: p.lineIds },
    )
    .filter((p) => {
      // A role or relationship ("my doctor") must be stated by a cited line or the note being edited.
      const source = [saidBy(p), p.action === "edit" ? (oldText.get(p.noteId) ?? "") : ""].join("\n");
      return unbackedRoles(`${p.name ?? ""} ${p.text}`, source).length === 0;
    });

  const sent = new Set(req.notes.map((n) => n.id));
  const edited = new Set(notes.flatMap((p) => (p.action === "edit" ? [p.noteId] : [])));
  // The person or place each new person or place note is about: its first name.
  const addedAbout = new Set(notes.flatMap((p) => (p.action === "add" && (p.kind === "person" || p.kind === "place") ? namesIn(`${p.name ?? ""} ${p.text}`).slice(0, 1) : [])));
  const removals: AssistProposal[] = [];
  for (const p of cited) {
    if (p.action !== "remove") continue;
    if (!sent.has(p.noteId) || edited.has(p.noteId) || removals.some((r) => r.action === "remove" && r.noteId === p.noteId)) continue;
    // Only when a cited line says it ended or asks for it to go.
    if (!ENDED.test(saidBy(p))) continue;
    // A new note about the same person or place with it should have been an edit.
    if (namesIn(oldText.get(p.noteId) ?? "").some((n) => addedAbout.has(n))) continue;
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
    // A phrase may say a role a sent note states ("my doctor" when a note says so), like any detail.
    if (unbackedRoles(text, [saidBy(p), ...req.notes.map((n) => n.text)].join("\n")).length) continue;
    if (phraseTexts.some((t) => isNearDuplicate(text, t))) continue;
    phraseTexts.push(text);
    phrases.push({ ...p, text });
  }

  return [...notes, ...removals, ...phrases];
}
