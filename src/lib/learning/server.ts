import { AllProvidersFailedError, streamCompletion, type StreamOptions } from "@/lib/server/providers";
import { checkProposals } from "./check";
import { buildLearnMessages, parseProposals } from "./prompt";
import type { LearnRequest, Proposal } from "./protocol";

export type LearnStreamOptions = Pick<StreamOptions, "order" | "configs" | "cooldown" | "signal" | "fetchImpl">;

/**
 * One batch. The model sees short ids (L1, N1) instead of the browser's long ones,
 * which saves tokens and copying mistakes; its proposals are mapped back and checked.
 * An id the model made up maps to one no line or note has, so the check drops it.
 */
export async function learnFromBatch(req: LearnRequest, opts: LearnStreamOptions): Promise<Proposal[]> {
  const lineIds = new Map(req.lines.map((l, i) => [`L${i + 1}`, l.id]));
  const noteIds = new Map(req.notes.map((n, i) => [`N${i + 1}`, n.id]));
  const short: LearnRequest = {
    today: req.today,
    lines: req.lines.map((l, i) => ({ ...l, id: `L${i + 1}` })),
    notes: req.notes.map((n, i) => ({ ...n, id: `N${i + 1}` })),
  };
  const { deltas } = await streamCompletion(buildLearnMessages(short), {
    ...opts,
    maxTokens: 1200,
    temperature: 0.2,
    firstTokenTimeoutMs: 10_000,
    idleTimeoutMs: 10_000,
  });
  let output = "";
  try {
    for await (const delta of deltas) output += delta;
  } catch (err) {
    // A cut-off answer is retried whole later, like a provider that never answered.
    throw new AllProvidersFailedError(`stream cut: ${err instanceof Error ? err.message : String(err)}`);
  }
  const proposals: Proposal[] = parseProposals(output).map((p) => ({
    action: p.action,
    kind: p.kind,
    ...(p.name ? { name: p.name } : {}),
    text: p.text,
    ...(p.note ? { noteId: noteIds.get(p.note) ?? `unknown:${p.note}` } : {}),
    lineIds: p.lines.map((id) => lineIds.get(id) ?? `unknown:${id}`),
  }));
  return checkProposals(proposals, req);
}
