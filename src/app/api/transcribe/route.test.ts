// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeWav } from "@/lib/hearing/wav";

const wav = encodeWav(new Float32Array(16000), 16000);
let ip = 0;
function post(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/transcribe", {
    method: "POST",
    body,
    headers: { host: "localhost", origin: "http://localhost", "x-forwarded-for": `10.1.0.${++ip}`, "content-type": "audio/wav", ...headers },
  });
}
const nova = (transcript: string) => ({ result: { results: { channels: [{ alternatives: [{ transcript }] }] } } });

describe("POST /api/transcribe", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "token");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the WAV to Nova-3 and returns its text", async () => {
    fetchMock.mockResolvedValue(Response.json(nova(" What size would you like? ")));
    const { POST } = await import("./route");
    const res = await POST(post(wav as BodyInit));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "What size would you like?" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/accounts/acct/ai/run/@cf/deepgram/nova-3");
    expect(init.headers.authorization).toBe("Bearer token");
    expect((init.body as Uint8Array).byteLength).toBe(wav.byteLength);
  });

  it("refuses other sites, oversized and non-WAV bodies", async () => {
    const { POST } = await import("./route");
    expect((await POST(post(wav as BodyInit, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(post(new Uint8Array(1_300_000)))).status).toBe(413);
    expect((await POST(post("hello")))).toHaveProperty("status", 400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says unavailable when Cloudflare refuses, fails or has no keys", async () => {
    const { POST } = await import("./route");
    fetchMock.mockResolvedValueOnce(new Response("used up your daily free allocation", { status: 429 }));
    expect((await POST(post(wav as BodyInit))).status).toBe(503);
    fetchMock.mockRejectedValueOnce(new TypeError("network"));
    expect((await POST(post(wav as BodyInit))).status).toBe(503);
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    expect((await POST(post(wav as BodyInit))).status).toBe(503);
  });

  it("limits each address to 60 turns a minute", async () => {
    fetchMock.mockImplementation(async () => Response.json(nova("hi")));
    const { POST } = await import("./route");
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await POST(post(wav as BodyInit, { "x-forwarded-for": "10.9.9.9" }))).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(60);
    expect(statuses.at(-1)).toBe(429);
  });
});
