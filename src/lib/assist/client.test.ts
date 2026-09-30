import { describe, expect, it, vi } from "vitest";
import { postAssist } from "./client";

const body = { job: null, today: "2026-10-05", lines: [{ id: "u1", speaker: "user" as const, text: "hi" }], notes: [], phrases: [] };
const reply = (status: number, data: unknown) => vi.fn(async () => new Response(JSON.stringify(data), { status }));

describe("postAssist", () => {
  it("returns the message and the proposals that read", async () => {
    const f = reply(200, { say: "Hello.", proposals: [{ action: "phrase", text: "Hi.", lineIds: ["u1"] }, { action: "nope" }] });
    expect(await postAssist(body, f as unknown as typeof fetch)).toEqual({ ok: true, say: "Hello.", proposals: [{ action: "phrase", text: "Hi.", lineIds: ["u1"] }] });
  });

  it("maps failures", async () => {
    expect(await postAssist(body, reply(429, {}) as unknown as typeof fetch)).toEqual({ ok: false, reason: "rate_limited" });
    expect(await postAssist(body, reply(502, {}) as unknown as typeof fetch)).toEqual({ ok: false, reason: "unreadable" });
    expect(await postAssist(body, reply(503, {}) as unknown as typeof fetch)).toEqual({ ok: false, reason: "unavailable" });
    expect(await postAssist(body, reply(400, {}) as unknown as typeof fetch)).toEqual({ ok: false, reason: "refused" });
    const down = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(await postAssist(body, down as unknown as typeof fetch)).toEqual({ ok: false, reason: "unavailable" });
  });
});
