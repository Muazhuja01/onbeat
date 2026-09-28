import { contextLine } from "@/lib/context";
import type { LanguagePack } from "@/lib/language-packs/types";
import type { MemoryStore } from "@/lib/memory/store";
import type { ConversationContext } from "@/lib/types";
import type { SuggestRequestBody } from "./protocol";
import type { ValidationSources } from "./validate";

export interface RequestInput {
  mode: SuggestRequestBody["mode"];
  typed: string;
  partnerSaid: string;
  context: ConversationContext;
}

/** Clamp to what the server accepts: the start of the typed text, the end of what the partner said. */
export function clampInput<T extends { typed: string; partnerSaid: string }>(input: T): T {
  return { ...input, typed: input.typed.slice(0, 500), partnerSaid: input.partnerSaid.slice(-1000) };
}

/**
 * Everything one suggestion request sends, and the sources its replies are
 * checked against. Shared by the app's client and the eval runner, so both
 * test the same thing.
 */
export async function buildSuggestRequest(args: {
  memory: MemoryStore;
  pack: LanguagePack;
  input: RequestInput;
  simple: boolean;
}): Promise<{ body: SuggestRequestBody; sources: ValidationSources }> {
  const { memory, pack, simple } = args;
  const { mode, typed, partnerSaid, context } = clampInput(args.input);
  const line = contextLine(context, (id) => memory.getNote(id));
  const query = `${typed} ${partnerSaid}`.trim();
  const notes = await memory.searchNotes(query, context, 8);
  const body: SuggestRequestBody = {
    mode,
    typed,
    partnerSaid,
    contextLine: line,
    notes: notes.map((n) => ({ id: n.id, text: n.text.slice(0, 300) })),
    examples: memory.styleExamples(query, 5).map((e) => e.slice(0, 200)),
    reactions: pack.reactions,
    maxWords: simple ? pack.simpleMaxWords : pack.maxWords,
  };
  const sources: ValidationSources = { notes: new Map(notes.map((n) => [n.id, n.text])), partnerSaid, typed, context: line };
  return { body, sources };
}
