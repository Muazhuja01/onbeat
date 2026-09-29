import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ChatMessage } from "@/lib/suggest/prompt";
import { judgeMessages, type JudgeInput } from "./judge";
import type { Judgement } from "./score";

export interface CachedAnswer {
  text: string;
  /** Which judge endpoint gave the answer ("groq" or "cloudflare"). */
  endpoint: string;
  model: string;
  /** The API's finish_reason for the answer, when it gave one ("length" means the token budget ran out). */
  finishReason?: string;
  /** Why no judgement could be read from this answer; set by askVoted, never cached. */
  note?: string;
}

const isAnswer = (v: unknown): v is CachedAnswer => {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return typeof a.text === "string" && typeof a.endpoint === "string" && typeof a.model === "string";
};

/**
 * Judge answers on disk, keyed by everything the judge sees (the full prompt) and the
 * prompt version (and the vote count), so a rerun only asks the judge about input it hasn't seen.
 * A voted entry stores the majority judgement as its text and "groq x3" style as its endpoint.
 * Written on every set, so an interrupted run keeps what it paid for.
 */
export class JudgeCache {
  private entries: Record<string, CachedAnswer> = {};

  constructor(private readonly file: string) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed)) if (isAnswer(v)) this.entries[k] = v;
      }
    } catch {
      this.entries = {};
    }
  }

  /** Also keyed on the vote count, so a single call and a majority of several never stand in for each other. */
  static key(p: { messages: ChatMessage[]; version: number; votes?: number }): string {
    return createHash("sha256").update(JSON.stringify([p.version, p.votes ?? 1, p.messages])).digest("hex");
  }

  get(key: string): CachedAnswer | undefined {
    return this.entries[key];
  }

  set(key: string, answer: CachedAnswer): void {
    this.entries[key] = answer;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify(this.entries)}\n`);
  }
}

/** "empty" or "not valid judge JSON", plus the finish reason when the API gave one. */
export function unreadableWhy(answer: CachedAnswer): string {
  const why = answer.text.trim() === "" ? "empty" : "not valid judge JSON";
  return answer.finishReason ? `${why}, finish_reason ${answer.finishReason}` : why;
}

/**
 * Answers from the cache when it can, otherwise asks the judge. Only an answer that
 * parses is cached and named in judgedBy ("cache:<endpoint>" for a hit); one that
 * does not parse is reported to log with the reason. A failing
 * cache write never loses the judgement. Errors from ask() propagate.
 */
export async function judgeWithCache(
  cache: JudgeCache,
  input: JudgeInput,
  version: number,
  ask: () => Promise<CachedAnswer>,
  parse: (text: string) => Judgement | null,
  votes = 1,
  log: (message: string) => void = () => {},
): Promise<{ judgement: Judgement | null; judgedBy?: string }> {
  const key = JudgeCache.key({ messages: judgeMessages(input), version, votes });
  const hit = cache.get(key);
  if (hit) {
    const judgement = parse(hit.text);
    if (judgement) return { judgement, judgedBy: `cache:${hit.endpoint}` };
  }
  const answer = await ask();
  const judgement = parse(answer.text);
  if (!judgement) {
    log(answer.note ?? `judge answer unreadable (${unreadableWhy(answer)})`);
    return { judgement: null };
  }
  try {
    cache.set(key, answer);
  } catch {
    // A full disk or a locked file only costs a future rerun.
  }
  return { judgement, judgedBy: answer.endpoint };
}
