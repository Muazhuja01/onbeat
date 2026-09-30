import { ProposalSchema, type LearnRequest, type Proposal } from "./protocol";

export type LearnResult = { ok: true; proposals: Proposal[] } | { ok: false; retry: boolean };

/** Refused batches: sending the same lines again would be refused again. */
const REFUSED = new Set([400, 403, 413]);

/** Sends one batch. A busy or unreachable service is worth another try; a refused batch is not. */
export async function postLearnBatch(body: LearnRequest, fetchImpl: typeof fetch = fetch): Promise<LearnResult> {
  let res: Response;
  try {
    res = await fetchImpl("/api/learn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, retry: true };
  }
  if (REFUSED.has(res.status)) return { ok: false, retry: false };
  if (!res.ok) return { ok: false, retry: true };
  const data = (await res.json().catch(() => null)) as { proposals?: unknown } | null;
  if (!data || !Array.isArray(data.proposals)) return { ok: false, retry: true };
  return {
    ok: true,
    proposals: data.proposals.flatMap((p) => {
      const r = ProposalSchema.safeParse(p);
      return r.success ? [r.data] : [];
    }),
  };
}
