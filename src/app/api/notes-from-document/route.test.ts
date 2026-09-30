// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const streamCompletion = vi.fn();
vi.mock("@/lib/server/providers", async (orig) => ({ ...(await orig<typeof import("@/lib/server/providers")>()), streamCompletion }));

async function* chunks(...parts: string[]) {
  for (const p of parts) yield p;
}

let ipCount = 0;
function post(file: File | null, headers: Record<string, string> = {}) {
  const form = new FormData();
  if (file) form.append("file", file);
  return new Request("http://localhost/api/notes-from-document", {
    method: "POST",
    body: form,
    headers: { host: "localhost", origin: "http://localhost", "x-forwarded-for": `10.0.0.${++ipCount}`, ...headers },
  });
}

describe("POST /api/notes-from-document", () => {
  beforeEach(() => streamCompletion.mockReset());

  it("returns draft notes from a text file", async () => {
    streamCompletion.mockResolvedValue({ provider: "groq", deltas: chunks('{"kind": "about-me", ', '"text": "I type to talk."}\n') });
    const { POST } = await import("./route");
    const res = await POST(post(new File(["I'm Maya and I type to talk."], "me.txt")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notes: [{ kind: "about-me", text: "I type to talk." }], truncated: false });
    expect(streamCompletion.mock.calls[0][1]).toMatchObject({ maxTokens: 4000 });
  });

  it("refuses other sites, big files, other types, empty text and no file", async () => {
    const { POST } = await import("./route");
    expect((await POST(post(new File(["x"], "a.txt"), { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(post(new File([new Uint8Array(4 * 1024 * 1024 + 1)], "a.txt")))).status).toBe(413);
    expect((await POST(post(new File(["x"], "a.exe")))).status).toBe(415);
    expect((await POST(post(new File(["   "], "a.txt")))).status).toBe(422);
    expect((await POST(post(new File(["not a pdf"], "a.pdf")))).status).toBe(422);
    expect((await POST(post(null))).status).toBe(400);
    expect(streamCompletion).not.toHaveBeenCalled();
  });

  it("limits each address to 5 documents a minute", async () => {
    streamCompletion.mockImplementation(async () => ({ provider: "groq", deltas: chunks("") }));
    const { POST } = await import("./route");
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await POST(post(new File(["Hi"], "a.txt"), { "x-forwarded-for": "10.9.9.9" }))).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("cuts long documents and says so", async () => {
    streamCompletion.mockResolvedValue({ provider: "groq", deltas: chunks("") });
    const { POST } = await import("./route");
    const res = await POST(post(new File(["word ".repeat(6_000)], "long.txt")));
    expect((await res.json()).truncated).toBe(true);
    const sent = streamCompletion.mock.calls[0][0].at(-1).content as string;
    expect(sent.length).toBeLessThan(22_000);
  });

  it("says when the AI is unavailable, before or during the answer", async () => {
    const { AllProvidersFailedError } = await import("@/lib/server/providers");
    const { POST } = await import("./route");
    streamCompletion.mockRejectedValueOnce(new AllProvidersFailedError("down"));
    expect((await POST(post(new File(["I'm Maya."], "a.txt")))).status).toBe(503);
    async function* broken() {
      yield '{"kind": "about-me", "text": "Hi"}\n';
      throw new Error("stream cut");
    }
    streamCompletion.mockResolvedValueOnce({ provider: "groq", deltas: broken() });
    expect((await POST(post(new File(["I'm Maya."], "a.txt")))).status).toBe(503);
  });
});
