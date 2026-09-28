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
}

const isAnswer = (v: unknown): v is CachedAnswer => {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return typeof a.text === "string" && typeof a.endpoint === "string" && typeof a.model === "string";
};

/**
 * Judge answers on disk, keyed by everything the judge sees (the full prompt) and the
 * prompt version, so a rerun only asks the judge about input it hasn't seen.
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

  static key(p: { messages: ChatMessage[]; version: number }): string {
    return createHash("sha256").update(JSON.stringify([p.version, p.messages])).digest("hex");
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

/**
 * Answers from the cache when it can, otherwise asks the judge. Only an answer that
 * parses is cached and named in judgedBy ("cache:<endpoint>" for a hit). A failing
 * cache write never loses the judgement. Errors from ask() propagate.
 */
export async function judgeWithCache(
  cache: JudgeCache,
  input: JudgeInput,
  version: number,
  ask: () => Promise<CachedAnswer>,
  parse: (text: string) => Judgement | null,
): Promise<{ judgement: Judgement | null; judgedBy?: string }> {
  const key = JudgeCache.key({ messages: judgeMessages(input), version });
  const hit = cache.get(key);
  if (hit) {
    const judgement = parse(hit.text);
    if (judgement) return { judgement, judgedBy: `cache:${hit.endpoint}` };
  }
  const answer = await ask();
  const judgement = parse(answer.text);
  if (!judgement) return { judgement: null };
  try {
    cache.set(key, answer);
  } catch {
    // A full disk or a locked file only costs a future rerun.
  }
  return { judgement, judgedBy: answer.endpoint };
}
