// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const streamCompletion = vi.fn();
vi.mock("@/lib/server/providers", async (orig) => ({ ...(await orig<typeof import("@/lib/server/providers")>()), streamCompletion }));

async function* chunks(...parts: string[]) {
  for (const p of parts) yield p;
}

const body = {
  today: "2026-09-30",
  lines: [
    { id: "line-uuid-1", speaker: "user", text: "My new carer Ana starts on Monday." },
    { id: "line-uuid-2", speaker: "partner", text: "Nice weather today." },
  ],
  notes: [{ id: "note-uuid-1", kind: "about-me", text: "I'm Maya." }],
};

let ipCount = 0;
function post(data: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/learn", {
    method: "POST",
    body: typeof data === "string" ? data : JSON.stringify(data),
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost", "x-forwarded-for": `10.1.0.${++ipCount}`, ...headers },
  });
}

describe("POST /api/learn", () => {
  beforeEach(() => streamCompletion.mockReset());

  it("returns checked proposals with the browser's ids, sending the model short ones", async () => {
    streamCompletion.mockResolvedValue({
      provider: "groq",
      deltas: chunks('{"action": "add", "kind": "person", "name": "Ana", ', '"text": "Ana is my new carer. She starts on Monday.", "lines": ["L1"]}\n'),
    });
    const { POST } = await import("./route");
    const res = await POST(post(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      proposals: [{ action: "add", kind: "person", name: "Ana", text: "Ana is my new carer. She starts on Monday.", lineIds: ["line-uuid-1"] }],
    });
    const sent = streamCompletion.mock.calls[0][0].at(-1).content as string;
    expect(sent).toContain("L1 Me: My new carer Ana starts on Monday.");
    expect(sent).toContain("N1 (about-me): I'm Maya.");
    expect(sent).not.toContain("line-uuid-1");
    expect(streamCompletion.mock.calls[0][1]).toMatchObject({ order: ["groq", "cloudflare"], temperature: 0.2 });
  });

  it("drops a proposal with an invented detail or an unknown line", async () => {
    streamCompletion.mockResolvedValue({
      provider: "groq",
      deltas: chunks(
        '{"action": "add", "kind": "person", "name": "Ana", "text": "Ana is my new carer. She starts on Tuesday.", "lines": ["L1"]}\n',
        '{"action": "add", "kind": "routine", "text": "My new carer starts on Monday.", "lines": ["L9"]}\n',
      ),
    });
    const { POST } = await import("./route");
    expect(await (await POST(post(body))).json()).toEqual({ proposals: [] });
  });

  it("refuses other sites, bad bodies and big bodies without calling the model", async () => {
    const { POST } = await import("./route");
    expect((await POST(post(body, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(post("{not json"))).status).toBe(400);
    expect((await POST(post({ ...body, lines: [] }))).status).toBe(400);
    expect((await POST(post("x".repeat(70_000)))).status).toBe(413);
    expect(streamCompletion).not.toHaveBeenCalled();
  });

  it("limits each address to 6 batches a minute", async () => {
    streamCompletion.mockImplementation(async () => ({ provider: "groq", deltas: chunks("") }));
    const { POST } = await import("./route");
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await POST(post(body, { "x-forwarded-for": "10.9.9.8" }))).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429]);
  });

  it("says when the AI is unavailable, before or during the answer", async () => {
    const { AllProvidersFailedError } = await import("@/lib/server/providers");
    const { POST } = await import("./route");
    streamCompletion.mockRejectedValueOnce(new AllProvidersFailedError("down"));
    expect((await POST(post(body))).status).toBe(503);
    async function* broken() {
      yield '{"action": "add", ';
      throw new Error("stream cut");
    }
    streamCompletion.mockResolvedValueOnce({ provider: "groq", deltas: broken() });
    expect((await POST(post(body))).status).toBe(503);
  });
});
