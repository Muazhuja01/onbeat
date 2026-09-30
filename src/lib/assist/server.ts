import { AllProvidersFailedError, streamCompletion, type StreamOptions } from "@/lib/server/providers";
import { checkAssistProposals } from "./check";
import { buildAssistMessages, parseAssistOutput, type RawAssistProposal } from "./prompt";
import type { AssistProposal, AssistRequest, AssistResponse } from "./protocol";

export type AssistStreamOptions = Pick<StreamOptions, "order" | "configs" | "cooldown" | "signal" | "fetchImpl">;

export class AssistUnreadableError extends Error {
  constructor() {
    super("assistant answer unreadable");
    this.name = "AssistUnreadableError";
  }
}

async function ask(req: AssistRequest, opts: AssistStreamOptions): Promise<string> {
  const { deltas } = await streamCompletion(buildAssistMessages(req), {
    ...opts,
    maxTokens: 1500,
    temperature: 0.3,
    firstTokenTimeoutMs: 10_000,
    idleTimeoutMs: 10_000,
  });
  let output = "";
  try {
    for await (const delta of deltas) output += delta;
  } catch (err) {
    throw new AllProvidersFailedError(`stream cut: ${err instanceof Error ? err.message : String(err)}`);
  }
  return output;
}

/**
 * One chat turn. The model sees short ids (U1, A1, N1, Q1); its proposals are mapped back
 * and checked. An id the model made up maps to one nothing has, so the check drops it.
 * Unreadable output is asked for once more, then reported.
 */
export async function assistTurn(req: AssistRequest, opts: AssistStreamOptions): Promise<AssistResponse> {
  let u = 0;
  let a = 0;
  const lineIds = new Map<string, string>();
  const lines = req.lines.map((l) => {
    const short = l.speaker === "user" ? `U${++u}` : `A${++a}`;
    lineIds.set(short, l.id);
    return { ...l, id: short };
  });
  const noteIds = new Map(req.notes.map((n, i) => [`N${i + 1}`, n.id]));
  const short: AssistRequest = {
    ...req,
    lines,
    notes: req.notes.map((n, i) => ({ ...n, id: `N${i + 1}` })),
    phrases: req.phrases.map((p, i) => ({ ...p, id: `Q${i + 1}` })),
  };

  let parsed = parseAssistOutput(await ask(short, opts));
  if (!parsed) parsed = parseAssistOutput(await ask(short, opts));
  if (!parsed) throw new AssistUnreadableError();

  const real = (ids: string[]) => ids.map((id) => lineIds.get(id) ?? `unknown:${id}`);
  const note = (id?: string) => noteIds.get(id ?? "") ?? `unknown:${id}`;
  const proposals = parsed.proposals.map((p: RawAssistProposal): AssistProposal => {
    switch (p.action) {
      case "remove":
        return { action: "remove", noteId: note(p.note), lineIds: real(p.lines) };
      case "phrase":
        return { action: "phrase", text: p.text!, ...(p.for ? { for: p.for } : {}), lineIds: real(p.lines) };
      case "edit":
        return { action: "edit", kind: p.kind!, ...(p.name ? { name: p.name } : {}), text: p.text!, noteId: note(p.note), lineIds: real(p.lines) };
      default:
        return { action: "add", kind: p.kind!, ...(p.name ? { name: p.name } : {}), text: p.text!, lineIds: real(p.lines) };
    }
  });
  return { say: parsed.say, proposals: checkAssistProposals(proposals, req) };
}
