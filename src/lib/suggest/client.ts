import { contextLine } from "@/lib/context";
import type { LanguagePack, Reaction } from "@/lib/language-packs/types";
import type { MemoryStore } from "@/lib/memory/store";
import { normalize } from "@/lib/text";
import type { Reply } from "@/lib/types";
import { createLineSplitter, parseLines, type ParsedLine, type SuggestRequestBody } from "./protocol";
import { buildSuggestRequest, clampInput, type RequestInput } from "./request";
import { isNearDuplicate, validateReply, type ValidationSources } from "./validate";

export type SuggestInput = RequestInput;

export interface SuggestUpdate {
  replies: Reply[];
  reactions: Reaction[];
  done: boolean;
  provider?: string;
}

export class SuggestUnavailableError extends Error {
  constructor(detail: string) {
    super(`Suggestions unavailable: ${detail}`);
    this.name = "SuggestUnavailableError";
  }
}

interface Deps {
  memory: MemoryStore;
  pack: LanguagePack;
  fetchImpl?: typeof fetch;
  endpoint?: string;
  simpleLanguage?: () => boolean;
}

interface StreamOutcome {
  replies: Reply[];
  reactions: Reaction[];
  invalid: number;
  provider?: string;
  /** True when the stream ended normally (not cut off by a mid-stream failure). */
  complete: boolean;
}

const CACHE_SIZE = 20;

export class SuggestClient {
  private controller: AbortController | null = null;
  private generation = 0;
  private cache = new Map<string, SuggestUpdate>();

  constructor(private readonly deps: Deps) {}

  cancel(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
  }

  /** Call when notes or phrases change, so stale suggestions aren't served from cache. */
  clearCache(): void {
    this.cache.clear();
  }

  async request(input: SuggestInput, onUpdate: (u: SuggestUpdate) => void): Promise<SuggestUpdate | null> {
    const clamped = clampInput(input);
    const { memory, pack } = this.deps;
    const simple = this.deps.simpleLanguage?.() ?? false;
    const line = contextLine(clamped.context, (id) => memory.getNote(id));
    const key = JSON.stringify([
      clamped.mode,
      normalize(clamped.typed.trim()),
      normalize(clamped.partnerSaid.trim()),
      clamped.context.placeId ?? "",
      clamped.context.partnerId ?? "",
      simple,
      line,
    ]);

    this.cancel();
    const cached = this.cache.get(key);
    if (cached) {
      onUpdate(cached);
      return cached;
    }

    const controller = new AbortController();
    this.controller = controller;
    const generation = this.generation;
    const isCurrent = () => generation === this.generation && !controller.signal.aborted;

    const { body, sources } = await buildSuggestRequest({ memory, pack, input: clamped, simple });
    if (!isCurrent()) return null;

    let outcome = await this.stream(body, sources, controller, isCurrent, onUpdate);
    if (outcome && outcome.replies.length === 0 && outcome.invalid > 0 && isCurrent()) {
      const other = outcome.provider === "cloudflare" ? "groq" : "cloudflare";
      outcome = await this.stream({ ...body, preferProvider: other }, sources, controller, isCurrent, onUpdate);
    }
    if (!outcome || !isCurrent()) return null;

    const final: SuggestUpdate = { replies: outcome.replies, reactions: outcome.reactions, done: true, provider: outcome.provider };
    onUpdate(final);
    if (outcome.complete && outcome.replies.length > 0) {
      this.cache.set(key, final);
      if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string);
    }
    if (this.controller === controller) this.controller = null;
    return final;
  }

  private async stream(
    body: SuggestRequestBody,
    sources: ValidationSources,
    controller: AbortController,
    isCurrent: () => boolean,
    onUpdate: (u: SuggestUpdate) => void,
  ): Promise<StreamOutcome | null> {
    let res: Response;
    try {
      res = await (this.deps.fetchImpl ?? fetch)(this.deps.endpoint ?? "/api/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (!isCurrent()) return null;
      throw new SuggestUnavailableError(err instanceof Error ? err.message : "network error");
    }
    if (!isCurrent()) return null;
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      throw new SuggestUnavailableError(`HTTP ${res.status}`);
    }

    const reactionsById = new Map(this.deps.pack.reactions.map((r) => [r.id, r]));
    const replies: Reply[] = [];
    let reactions: Reaction[] = [];
    let invalid = 0;

    const handle = (parsed: ParsedLine) => {
      if (parsed.kind === "invalid") {
        invalid++;
        return;
      }
      if (parsed.kind === "reactions") {
        reactions = parsed.ids.map((id) => reactionsById.get(id)).filter((r): r is Reaction => !!r).slice(0, 2);
      } else {
        if (replies.length >= 3) return;
        if (!validateReply({ text: parsed.text, noteIds: parsed.noteIds }, sources).ok) return;
        if (replies.some((r) => isNearDuplicate(r.text, parsed.text))) return;
        replies.push({ text: parsed.text, noteIds: parsed.noteIds, source: "model" });
      }
      if (isCurrent()) onUpdate({ replies: [...replies], reactions, done: false });
    };
    const splitter = createLineSplitter((line) => parseLines(line).forEach(handle));

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let complete = false;
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch {
        if (!isCurrent()) return null;
        // Mid-stream failure (Task 8 R12: the reader rejects). Keep what already arrived.
        break;
      }
      if (result.done) {
        complete = true;
        break;
      }
      if (!isCurrent()) {
        await reader.cancel().catch(() => {});
        return null;
      }
      try {
        splitter.push(decoder.decode(result.value, { stream: true }));
      } catch (err) {
        await reader.cancel().catch(() => {});
        throw err;
      }
    }
    if (complete) splitter.flush();
    return { replies, reactions, invalid, provider: res.headers.get("x-onbeat-provider") ?? undefined, complete };
  }
}
