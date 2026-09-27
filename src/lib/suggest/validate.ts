import { normalize, tokenize } from "@/lib/text";

const DAYS_AND_MONTHS = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
]);

const NEVER_NAMES = new Set(["i", "i'm", "i'll", "i've", "i'd", "ok", "okay"]);

const NUMBER = /\d+(?:[:.]\d+)?/g;
const WORD = /[\p{L}][\p{L}'\u2019-]*/gu;

function canonicalNumber(n: string): string {
  return n.replace(".", ":");
}

/**
 * Details that must be backed by a source: numbers and times, day and month
 * names anywhere, and capitalised words after the first word of a sentence.
 * Limitation: a name as the very first word of a sentence is not detected,
 * because it can't be told apart from an ordinary capitalised word
 * ("Large, please.") without a dictionary.
 */
export function extractClaims(text: string): string[] {
  const claims: string[] = [];
  for (const m of text.matchAll(NUMBER)) claims.push(canonicalNumber(m[0]));
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const words = sentence.match(WORD) ?? [];
    words.forEach((word, i) => {
      const n = normalize(word).replace(/'s$/, "");
      if (NEVER_NAMES.has(n)) return;
      if (DAYS_AND_MONTHS.has(n)) {
        claims.push(word.replace(/['\u2019]s$/, ""));
        return;
      }
      if (i > 0 && /^\p{Lu}/u.test(word)) claims.push(word.replace(/['\u2019]s$/, ""));
    });
  }
  return claims;
}

export function claimSupported(claim: string, sourceText: string): boolean {
  if (/^\d/.test(claim)) {
    const numbers = [...sourceText.matchAll(NUMBER)].map((m) => canonicalNumber(m[0]));
    return numbers.includes(canonicalNumber(claim));
  }
  const target = normalize(claim).replace(/'s$/, "");
  const words = (normalize(sourceText).match(WORD) ?? []).flatMap((w) => [w, w.replace(/'s$/, "")]);
  if (words.includes(target)) return true;
  // Days in notes are often plural ("Tuesdays").
  return DAYS_AND_MONTHS.has(target) && words.includes(`${target}s`);
}

export interface ValidationSources {
  notes: Map<string, string>;
  partnerSaid: string;
  typed: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: "unknown-note" | "unsupported-detail"; detail: string };

export function validateReply(reply: { text: string; noteIds: string[] }, sources: ValidationSources): ValidationResult {
  for (const id of reply.noteIds) {
    if (!sources.notes.has(id)) return { ok: false, reason: "unknown-note", detail: id };
  }
  const sourceText = [...reply.noteIds.map((id) => sources.notes.get(id) ?? ""), sources.partnerSaid, sources.typed].join("\n");
  for (const claim of extractClaims(reply.text)) {
    if (!claimSupported(claim, sourceText)) return { ok: false, reason: "unsupported-detail", detail: claim };
  }
  return { ok: true };
}

export function isNearDuplicate(a: string, b: string): boolean {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return ta.size === tb.size;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = ta.size + tb.size - shared;
  return shared / union >= 0.6 && (shared === ta.size || shared === tb.size || shared / union >= 0.8);
}
