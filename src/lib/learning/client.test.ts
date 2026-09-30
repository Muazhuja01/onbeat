import { describe, expect, it, vi } from "vitest";
import { postLearnBatch } from "./client";
import type { LearnRequest } from "./protocol";

const body: LearnRequest = { today: "2026-09-30", lines: [{ id: "a", speaker: "user", text: "Hi" }], notes: [] };
const respond = (status: number, data: unknown) => vi.fn(async () => new Response(JSON.stringify(data), { status })) as unknown as typeof fetch;

describe("postLearnBatch", () => {
  it("posts the batch and returns well-formed proposals only", async () => {
    const good = { action: "add", kind: "preference", text: "I like tea.", lineIds: ["a"] };
    const fetchImpl = respond(200, { proposals: [good, { action: "add", kind: "friend", text: "x", lineIds: ["a"] }] });
    expect(await postLearnBatch(body, fetchImpl)).toEqual({ ok: true, proposals: [good] });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/learn");
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("retries later when the service is busy, unreachable or answers nonsense", async () => {
    expect(await postLearnBatch(body, respond(503, { error: "unavailable" }))).toEqual({ ok: false, retry: true });
    expect(await postLearnBatch(body, respond(429, { error: "rate_limited" }))).toEqual({ ok: false, retry: true });
    expect(await postLearnBatch(body, respond(200, { nope: true }))).toEqual({ ok: false, retry: true });
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await postLearnBatch(body, offline)).toEqual({ ok: false, retry: true });
  });

  it("gives up on a batch the server refuses, so it isn't sent forever", async () => {
    expect(await postLearnBatch(body, respond(400, { error: "invalid_request" }))).toEqual({ ok: false, retry: false });
    expect(await postLearnBatch(body, respond(413, { error: "too_large" }))).toEqual({ ok: false, retry: false });
    expect(await postLearnBatch(body, respond(403, { error: "forbidden" }))).toEqual({ ok: false, retry: false });
  });
});
