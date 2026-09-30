import { AssistProposalSchema, type AssistProposal, type AssistRequest } from "./protocol";

export type AssistResult = { ok: true; say: string; proposals: AssistProposal[] } | { ok: false; reason: "unavailable" | "unreadable" | "rate_limited" | "refused" };

const REFUSED = new Set([400, 403, 413]);

/** One chat turn. Proposals that don't read are left out; the message still shows. */
export async function postAssist(body: AssistRequest, fetchImpl: typeof fetch = fetch): Promise<AssistResult> {
  let res: Response;
  try {
    res = await fetchImpl("/api/assist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (res.status === 429) return { ok: false, reason: "rate_limited" };
  if (res.status === 502) return { ok: false, reason: "unreadable" };
  if (REFUSED.has(res.status)) return { ok: false, reason: "refused" };
  if (!res.ok) return { ok: false, reason: "unavailable" };
  const data = (await res.json().catch(() => null)) as { say?: unknown; proposals?: unknown } | null;
  if (!data || typeof data.say !== "string" || !Array.isArray(data.proposals)) return { ok: false, reason: "unavailable" };
  return {
    ok: true,
    say: data.say,
    proposals: data.proposals.flatMap((p) => {
      const r = AssistProposalSchema.safeParse(p);
      return r.success ? [r.data] : [];
    }),
  };
}
