// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const URL_BASE = "https://example--onbeat-voice-voice-web.modal.run";
let POST: (r: Request) => Promise<Response>;

function req(body: unknown, opts: { warm?: boolean; origin?: string; ip?: string } = {}) {
  return new Request(`http://localhost/api/speak${opts.warm ? "?warm=1" : ""}`, {
    method: "POST",
    headers: { host: "localhost", origin: opts.origin ?? "http://localhost", "x-forwarded-for": opts.ip ?? "1.2.3.4", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("MODAL_SPEAK_URL", URL_BASE);
  vi.stubEnv("MODAL_TOKEN_ID", "wk-id");
  vi.stubEnv("MODAL_TOKEN_SECRET", "ws-secret");
  ({ POST } = await import("./route"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/api/speak", () => {
  it("passes a valid line to the voice server with the token and returns the WAV", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([82, 73, 70, 70]), { status: 200, headers: { "content-type": "audio/wav" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(req({ text: " Hello ", voice: "m_gb_gentle", speed: 0.85 }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([82, 73, 70, 70]));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${URL_BASE}/speak`);
    expect(init.headers).toMatchObject({ "Modal-Key": "wk-id", "Modal-Secret": "ws-secret" });
    expect(JSON.parse(init.body as string)).toEqual({ text: "Hello", voice: "m_gb_gentle", speed: 0.85 });
  });

  it("refuses other sites and bad requests", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await POST(req({ text: "Hi", voice: "m_gb_gentle", speed: 1 }, { origin: "https://evil.example" }))).status).toBe(403);
    for (const body of [{ text: "", voice: "m_gb_gentle", speed: 1 }, { text: "x".repeat(301), voice: "m_gb_gentle", speed: 1 }, { text: "Hi", voice: "af_heart", speed: 1 }, { text: "Hi", voice: "m_gb_gentle", speed: 2 }, "junk"])
      expect((await POST(req(body))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("limits each address to 90 lines a minute", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })));
    for (let i = 0; i < 90; i++) expect((await POST(req({ text: "Hi", voice: "m_gb_gentle", speed: 1 }, { ip: "9.9.9.9" }))).status).toBe(200);
    expect((await POST(req({ text: "Hi", voice: "m_gb_gentle", speed: 1 }, { ip: "9.9.9.9" }))).status).toBe(429);
  });

  it("answers 503 when settings are missing, the server fails or times out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    expect((await POST(req({ text: "Hi", voice: "m_gb_gentle", speed: 1 }))).status).toBe(503);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); }));
    expect((await POST(req({ text: "Hi", voice: "m_gb_gentle", speed: 1 }))).status).toBe(503);
    vi.stubEnv("MODAL_TOKEN_SECRET", "");
    vi.resetModules();
    ({ POST } = await import("./route"));
    expect((await POST(req({ text: "Hi", voice: "m_gb_gentle", speed: 1 }))).status).toBe(503);
  });

  it("wakes the voice server, at most 10 times a minute per address", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(req(undefined, { warm: true, ip: "5.5.5.5" }))).status).toBe(204);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(`${URL_BASE}/warm`);
    for (let i = 0; i < 9; i++) await POST(req(undefined, { warm: true, ip: "5.5.5.5" }));
    expect((await POST(req(undefined, { warm: true, ip: "5.5.5.5" }))).status).toBe(429);
    fetchMock.mockImplementation(async () => new Response(null, { status: 502 }));
    expect((await POST(req(undefined, { warm: true, ip: "6.6.6.6" }))).status).toBe(503);
  });
});
