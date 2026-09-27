import { contextLine } from "@/lib/context";
import type { LanguagePack, Reaction } from "@/lib/language-packs/types";
import type { MemoryStore } from "@/lib/memory/store";
import { normalize } from "@/lib/text";
import type { ConversationContext, Reply } from "@/lib/types";
import { createLineSplitter, parseLine, type SuggestRequestBody } from "./protocol";
import { isNearDuplicate, validateReply, type ValidationSources } from "./validate";

export interface SuggestInput {
  mode: SuggestRequestBody["mode"];
  typed: string;
  partnerSaid: string;
  context: ConversationContext;
}

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

  async request(input: SuggestInput, onUpdate: (u: SuggestUpdate) => void): Promise<SuggestUpdate | null> {
    const typed = input.typed.slice(0, 500);
    const partnerSaid = input.partnerSaid.slice(-1000);
    const key = JSON.stringify([
      input.mode,
      normalize(typed.trim()),
      normalize(partnerSaid.trim()),
      input.context.placeId ?? "",
      input.context.partnerId ?? "",
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

    const { memory, pack } = this.deps;
    const query = `${typed} ${partnerSaid}`.trim();
    const notes = await memory.searchNotes(query, input.context, 8);
    if (!isCurrent()) return null;

    const simple = this.deps.simpleLanguage?.() ?? false;
    const body: SuggestRequestBody = {
      mode: input.mode,
      typed,
      partnerSaid,
      contextLine: contextLine(input.context, (id) => memory.getNote(id)),
      notes: notes.map((n) => ({ id: n.id, text: n.text.slice(0, 300) })),
      examples: memory.styleExamples(query, 5).map((e) => e.slice(0, 200)),
      reactions: pack.reactions,
      maxWords: simple ? pack.simpleMaxWords : pack.maxWords,
    };
    const sources: ValidationSources = { notes: new Map(notes.map((n) => [n.id, n.text])), partnerSaid, typed };

    let outcome = await this.stream(body, sources, controller, isCurrent, onUpdate);
    if (outcome && outcome.replies.length === 0 && outcome.invalid > 0 && isCurrent()) {
      const other = outcome.provider === "cloudflare" ? "groq" : "cloudflare";
      outcome = await this.stream({ ...body, preferProvider: other }, sources, controller, isCurrent, onUpdate);
    }
    if (!outcome || !isCurrent()) return null;

    const final: SuggestUpdate = { replies: outcome.replies, reactions: outcome.reactions, done: true, provider: outcome.provider };
    onUpdate(final);
    this.cache.set(key, final);
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string);
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
    if (!res.ok || !res.body) throw new SuggestUnavailableError(`HTTP ${res.status}`);

    const reactionsById = new Map(this.deps.pack.reactions.map((r) => [r.id, r]));
    const replies: Reply[] = [];
    let reactions: Reaction[] = [];
    let invalid = 0;

    const splitter = createLineSplitter((line) => {
      const parsed = parseLine(line);
      if (!parsed) return;
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
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!isCurrent()) {
          await reader.cancel().catch(() => {});
          return null;
        }
        splitter.push(decoder.decode(value, { stream: true }));
      }
      splitter.flush();
    } catch {
      if (!isCurrent()) return null;
      // Mid-stream failure: keep what already arrived.
    }
    return { replies, reactions, invalid, provider: res.headers.get("x-onbeat-provider") ?? undefined };
  }
}
