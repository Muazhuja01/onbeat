// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const body = {
  mode: "replies",
  typed: "",
  partnerSaid: "What size?",
  contextLine: "It is Tuesday morning.",
  notes: [],
  examples: [],
  reactions: [],
  maxWords: 15,
};

let ip = 0;
function req(data: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/suggest", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", "x-forwarded-for": `10.0.0.${++ip}`, ...headers },
    body: typeof data === "string" ? data : JSON.stringify(data),
  });
}

function sseResponse(text: string): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`));
        c.close();
      },
    }),
  );
}

function erroringSseResponse(text: string): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
        // Simulate the upstream connection dropping mid-stream: no [DONE], just an error.
        // Delayed so the first chunk is actually read before the stream errors (erroring
        // resets the stream's internal queue, discarding any not-yet-read chunk).
        setTimeout(() => c.error(new Error("upstream dropped")), 20);
      },
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", "test-groq");
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-cloudflare");
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acc");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/suggest", () => {
  it("streams model text with the provider header", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse('{"reply":"Large, please.","notes":[]}\n')));
    const res = await POST(req(body));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-onbeat-provider")).toBe("groq");
    expect(await res.text()).toBe('{"reply":"Large, please.","notes":[]}\n');
  });

  it("prefers cloudflare when asked", async () => {
    const fetchMock = vi.fn(async () => sseResponse("x"));
    vi.stubGlobal("fetch", fetchMock);
    await POST(req({ ...body, preferProvider: "cloudflare" }));
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("cloudflare");
  });

  it("rejects invalid bodies and bad JSON", async () => {
    expect((await POST(req({ ...body, maxWords: 99 }))).status).toBe(400);
    expect((await POST(req("{nope"))).status).toBe(400);
  });

  it("rejects cross-origin requests", async () => {
    expect((await POST(req(body, { origin: "https://evil.example" }))).status).toBe(403);
  });

  it("rejects bodies over 16 KB", async () => {
    expect((await POST(req({ ...body, contextLine: "x".repeat(17_000) }))).status).toBe(413);
  });

  it("rate limits per IP", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse("x")));
    const headers = { "x-forwarded-for": "192.168.1.1" };
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await POST(req(body, headers))).status;
    expect(last).toBe(429);
  });

  it("returns 503 when all providers fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    const res = await POST(req(body));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });

  it("surfaces a mid-stream provider error instead of silently ending the reply", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => erroringSseResponse("Large, please.")));
    const res = await POST(req(body));
    expect(res.status).toBe(200);
    await expect(res.text()).rejects.toThrow();
  });

  it("rejects a malformed Origin header instead of crashing", async () => {
    expect((await POST(req(body, { origin: "null" }))).status).toBe(403);
  });

  it("allows a same-origin Origin header", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse("x")));
    const res = await POST(req(body, { origin: "http://localhost:3000" }));
    expect(res.status).not.toBe(403);
  });
});
