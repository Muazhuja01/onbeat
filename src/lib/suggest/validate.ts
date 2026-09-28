import { normalize, tokenize } from "@/lib/text";
import { COMMON_WORDS } from "./common-words";

const DAYS_AND_MONTHS = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
]);

/**
 * Days named relative to now. "today" is left out: it is always true and
 * shows up in everyday replies ("Not today, thanks").
 */
const RELATIVE_DAYS = new Set(["tomorrow", "yesterday", "tonight"]);

/** Relative time phrases that state when something happens, so they need a source. */
const RELATIVE_TIMES = /\b(?:(?:this|next|last) (?:week|weekend|month)|later today)\b/gi;

/** A full stop after these doesn't end a sentence, so the name after them is still checked. */
const SENTENCE_END = /(?<=[.!?])(?<!\b(?:Dr|Mr|Mrs|Ms)\.)\s+/;

const NEVER_NAMES = new Set(["i", "i'm", "i'll", "i've", "i'd", "ok", "okay"]);

/**
 * Number words that state a quantity or time. "one" is left out on purpose:
 * "one moment", "the other one" and "one more" are everyday phrases.
 */
const NUMBER_WORDS = new Map<string, number>([
  ["two", 2], ["three", 3], ["four", 4], ["five", 5], ["six", 6], ["seven", 7],
  ["eight", 8], ["nine", 9], ["ten", 10], ["eleven", 11], ["twelve", 12],
  ["fifteen", 15], ["twenty", 20], ["thirty", 30], ["forty", 40], ["fifty", 50],
  ["hundred", 100], ["noon", 12], ["midnight", 12],
]);

const NUMBER = /\d+(?:[:.]\d+)?/g;
const WORD = /[\p{L}][\p{L}'\u2019-]*/gu;

function canonicalNumber(n: string): string {
  return n.replace(".", ":");
}

/**
 * Details that must be backed by a source: numbers and times, day and month names,
 * relative days and time phrases (tomorrow, this week, later today) anywhere, and
 * capitalised words that could be names: any capitalised word after the first word
 * of a sentence, and a capitalised first word that is not an everyday word.
 */
export function extractClaims(text: string): string[] {
  const claims: string[] = [];
  for (const m of text.matchAll(NUMBER)) claims.push(canonicalNumber(m[0]));
  for (const m of text.matchAll(RELATIVE_TIMES)) claims.push(m[0].toLowerCase());
  for (const sentence of text.split(SENTENCE_END)) {
    const words = sentence.match(WORD) ?? [];
    words.forEach((word, i) => {
      const n = normalize(word).replace(/'s$/, "");
      if (NEVER_NAMES.has(n)) return;
      if (NUMBER_WORDS.has(n)) {
        claims.push(n);
        return;
      }
      if (DAYS_AND_MONTHS.has(n) || RELATIVE_DAYS.has(n)) {
        claims.push(word.replace(/['\u2019]s$/, ""));
        return;
      }
      if (!/^\p{Lu}/u.test(word)) return;
      if (i > 0 || !COMMON_WORDS.has(normalize(word))) claims.push(word.replace(/['\u2019]s$/, ""));
    });
  }
  return claims;
}

export function claimSupported(claim: string, sourceText: string): boolean {
  if (/\s/.test(claim)) return normalize(sourceText).includes(normalize(claim));
  const sourceNumbers = [...sourceText.matchAll(NUMBER)].map((m) => canonicalNumber(m[0]));
  const words = (normalize(sourceText).match(WORD) ?? []).flatMap((w) => [w, w.replace(/'s$/, "")]);
  if (/^\d/.test(claim)) {
    if (sourceNumbers.includes(canonicalNumber(claim))) return true;
    // A plain "2" is backed by "two" in the source; a time like "2:30" needs its digits.
    if (!/^\d+$/.test(claim)) return false;
    return words.some((w) => NUMBER_WORDS.get(w) === Number(claim));
  }
  const target = normalize(claim).replace(/'s$/, "");
  if (words.includes(target)) return true;
  const value = NUMBER_WORDS.get(target);
  if (value !== undefined) return sourceNumbers.includes(String(value)) || sourceNumbers.includes(`${value}:00`);
  // Days in notes are often plural ("Tuesdays").
  return DAYS_AND_MONTHS.has(target) && words.includes(`${target}s`);
}

export interface ValidationSources {
  notes: Map<string, string>;
  partnerSaid: string;
  typed: string;
  /** The situation line sent to the model (weekday, time of day, place and partner names). */
  context?: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: "unknown-note" | "unsupported-detail"; detail: string };

export function validateReply(reply: { text: string; noteIds: string[] }, sources: ValidationSources): ValidationResult {
  for (const id of reply.noteIds) {
    if (!sources.notes.has(id)) return { ok: false, reason: "unknown-note", detail: id };
  }
  const sourceText = [
    ...reply.noteIds.map((id) => sources.notes.get(id) ?? ""),
    sources.partnerSaid,
    sources.typed,
    sources.context ?? "",
  ].join("\n");
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
