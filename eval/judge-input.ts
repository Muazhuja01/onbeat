import { personas } from "@/data/personas";
import { en } from "@/lib/language-packs/en";
import { MemoryStore } from "@/lib/memory/store";
import type { SuggestRequestBody } from "@/lib/suggest/protocol";
import { buildSuggestRequest } from "@/lib/suggest/request";
import type { ValidationSources } from "@/lib/suggest/validate";
import type { JudgeInput } from "./judge";
import type { Scenario } from "./scenarios";

/** A Tuesday morning, so the weekday and time of day in every prompt stay the same. */
export const EVAL_NOW = new Date(2026, 8, 29, 9, 0);

/** What the judge sees about a scenario, apart from the replies. */
export type ScenarioJudgeInput = Omit<JudgeInput, "candidates">;

/**
 * The suggestion request a scenario sends, the sources its replies are checked
 * against, and what the judge is told about it. Notes come from text search over
 * the persona's notes (no embedder), so the same scenario always builds the same request.
 */
export async function scenarioRequest(sc: Scenario, now: Date = EVAL_NOW): Promise<{ body: SuggestRequestBody; sources: ValidationSources; judgeInput: ScenarioJudgeInput }> {
  const persona = personas.find((p) => p.id === sc.persona)!;
  const memory = await MemoryStore.create();
  await memory.replaceAll(persona.notes, persona.phrases);
  const typed = sc.typed ?? "";
  const context = {
    now,
    placeId: sc.placeId === null ? undefined : (sc.placeId ?? persona.defaultPlaceId),
    partnerId: sc.partnerId === null ? undefined : (sc.partnerId ?? persona.defaultPartnerId),
  };
  const { body, sources } = await buildSuggestRequest({
    memory,
    pack: en,
    input: { mode: "replies+reactions", typed, partnerSaid: sc.partnerSaid, context },
    simple: false,
  });
  const judgeInput = { intended: sc.intended, partnerSaid: sc.partnerSaid, typed, contextLine: body.contextLine, notes: body.notes.map((n) => n.text), phrases: body.examples };
  return { body, sources, judgeInput };
}

/** The judge input for a scenario without generating any replies. */
export async function scenarioJudgeInput(sc: Scenario, now: Date = EVAL_NOW): Promise<ScenarioJudgeInput> {
  return (await scenarioRequest(sc, now)).judgeInput;
}
