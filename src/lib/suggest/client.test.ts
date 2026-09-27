import { describe, expect, it, vi } from "vitest";
import { SuggestClient, SuggestUnavailableError, type SuggestUpdate } from "./client";
import { MemoryStore } from "@/lib/memory/store";
import { en } from "@/lib/language-packs/en";
import type { Note } from "@/lib/types";

const NOTES: Note[] = [
  { id: "cafe", kind: "place", text: "Blue Door Café is my local coffee shop.", entities: ["Blue Door Café"], updatedAt: 0 },
  { id: "sam", kind: "person", text: "Sam is the barista at Blue Door Café.", entities: ["Sam", "Blue Door Café"], updatedAt: 0 },
];

async function memory() {
  const m = await MemoryStore.create();
  await m.replaceAll(NOTES, []);
  return m;
}

function streamResponse(lines: string[], opts: { provider?: string; failAfter?: number } = {}): Response {
  const enc = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (opts.failAfter !== undefined && i === opts.failAfter) {
        c.error(new Error("connection reset"));
        return;
      }
      if (i >= lines.length) {
        c.close();
        return;
      }
      c.enqueue(enc.encode(lines[i++] + "\n"));
    },
  });
  return new Response(body, { status: 200, headers: { "x-onbeat-provider": opts.provider ?? "groq" } });
}

const ctx = { now: new Date(2026, 8, 29, 8), placeId: "cafe", partnerId: "sam" };
const input = { mode: "replies+reactions" as const, typed: "", partnerSaid: "What size would you like?", context: ctx };

describe("SuggestClient", () => {
  it("streams validated replies and reactions", async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([
        '{"reply": "Large, please.", "notes": []}',
        '{"reply": "Hi Sam, my usual please.", "notes": ["sam"]}',
        '{"reply": "What sizes do you have?", "notes": []}',
        '{"reactions": ["mm-hmm", "not-a-reaction", "thanks"]}',
      ]),
    );
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl });
    const updates: SuggestUpdate[] = [];
    const final = await client.request(input, (u) => updates.push(u));
    expect(final?.replies.map((r) => r.text)).toEqual(["Large, please.", "Hi Sam, my usual please.", "What sizes do you have?"]);
    expect(final?.reactions.map((r) => r.id)).toEqual(["mm-hmm", "thanks"]);
    expect(final?.provider).toBe("groq");
    expect(updates[0].replies).toHaveLength(1);
    expect(updates.at(-1)?.done).toBe(true);
  });

  it("sends the context, notes and limits in the body", async () => {
    const fetchImpl = vi.fn(async () => streamResponse([]));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl, simpleLanguage: () => true });
    await client.request(input, () => {});
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.contextLine).toContain("Place: Blue Door Café. Talking with: Sam.");
    expect(body.notes.map((n: { id: string }) => n.id).slice(0, 2).sort()).toEqual(["cafe", "sam"]);
    expect(body.maxWords).toBe(en.simpleMaxWords);
  });

  it("drops invented details and duplicates", async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse(['{"reply": "Say hi to Priya.", "notes": []}', '{"reply": "Large, please.", "notes": []}', '{"reply": "large please", "notes": []}']),
    );
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl });
    const final = await client.request(input, () => {});
    expect(final?.replies.map((r) => r.text)).toEqual(["Large, please."]);
  });

  it("ignores junk lines", async () => {
    const fetchImpl = vi.fn(async () => streamResponse(["```json", "Sure! Here you go:", '{"reply": "Large, please."}', "```"]));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl });
    expect((await client.request(input, () => {}))?.replies).toHaveLength(1);
  });

  it("retries once on the other provider when output is all junk", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(streamResponse(["I cannot help with that."], { provider: "groq" }))
      .mockResolvedValueOnce(streamResponse(['{"reply": "Large, please."}'], { provider: "cloudflare" }));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl });
    const final = await client.request(input, () => {});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body as string).preferProvider).toBe("cloudflare");
    expect(final?.provider).toBe("cloudflare");
  });

  it("keeps partial results on mid-stream failure", async () => {
    const fetchImpl = vi.fn(async () => streamResponse(['{"reply": "Large, please."}', '{"reply": "Medium."}'], { failAfter: 1 }));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl });
    expect((await client.request(input, () => {}))?.replies.map((r) => r.text)).toEqual(["Large, please."]);
  });

  it("throws SuggestUnavailableError on HTTP errors", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"unavailable"}', { status: 503 }));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl });
    await expect(client.request(input, () => {})).rejects.toBeInstanceOf(SuggestUnavailableError);
  });

  it("a newer request cancels the older one", async () => {
    let releaseFirst: (() => void) | undefined;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const { typed } = JSON.parse(init.body as string) as { typed: string };
      if (typed === "old") {
        await new Promise<void>((r) => (releaseFirst = r));
        if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
        return streamResponse(['{"reply": "Old."}']);
      }
      return streamResponse(['{"reply": "New."}']);
    });
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl: fetchImpl as unknown as typeof fetch });
    const seen: string[] = [];
    const first = client.request({ ...input, typed: "old" }, (u) => u.replies.forEach((r) => seen.push(r.text)));
    await vi.waitFor(() => expect(releaseFirst).toBeDefined());
    const second = client.request({ ...input, typed: "new" }, (u) => u.replies.forEach((r) => seen.push(r.text)));
    releaseFirst?.();
    expect(await first).toBeNull();
    expect((await second)?.replies[0].text).toBe("New.");
    expect(seen).not.toContain("Old.");
  });

  it("serves repeated requests from cache", async () => {
    const fetchImpl = vi.fn(async () => streamResponse(['{"reply": "Large, please."}']));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl });
    await client.request(input, () => {});
    const again = await client.request(input, () => {});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(again?.replies[0].text).toBe("Large, please.");
  });

  it("clamps long input", async () => {
    const fetchImpl = vi.fn(async () => streamResponse([]));
    const client = new SuggestClient({ memory: await memory(), pack: en, fetchImpl });
    await client.request({ ...input, typed: "a".repeat(900), partnerSaid: "b".repeat(3000) }, () => {});
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.typed).toHaveLength(500);
    expect(body.partnerSaid).toHaveLength(1000);
  });
});
