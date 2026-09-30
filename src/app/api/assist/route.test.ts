// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const turn = vi.fn();
vi.mock("@/lib/assist/server", async (orig) => ({ ...(await orig<typeof import("@/lib/assist/server")>()), assistTurn: (...args: unknown[]) => turn(...args) }));

const body = {
  job: "phrases",
  today: "2026-10-05",
  lines: [{ id: "u1", speaker: "user", text: "Phrases for the café please." }],
  notes: [],
  phrases: [],
};

let ipCount = 0;
const post = async (data: unknown, headers: Record<string, string> = {}) => {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/assist", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost", "x-forwarded-for": `10.2.0.${++ipCount}`, ...headers },
      body: typeof data === "string" ? data : JSON.stringify(data),
    }),
  );
};

describe("POST /api/assist", () => {
  beforeEach(() => turn.mockReset());

  it("answers with the turn", async () => {
    turn.mockResolvedValue({ say: "Who are they for?", proposals: [] });
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ say: "Who are they for?", proposals: [] });
  });

  it("refuses another site, a bad body and a big body without calling the model", async () => {
    expect((await post(body, { origin: "https://evil.test" })).status).toBe(403);
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ ...body, lines: [] })).status).toBe(400);
    expect((await post("x".repeat(70_000))).status).toBe(413);
    expect(turn).not.toHaveBeenCalled();
  });

  it("limits each address to 10 turns a minute", async () => {
    turn.mockResolvedValue({ say: "ok", proposals: [] });
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await post(body, { "x-forwarded-for": "10.9.9.8" })).status);
    expect(statuses).toEqual([...Array(10).fill(200), 429]);
  });

  it("says when the answer is unreadable or the AI is unavailable", async () => {
    const { AssistUnreadableError } = await import("@/lib/assist/server");
    turn.mockRejectedValueOnce(new AssistUnreadableError());
    expect((await post(body)).status).toBe(502);
    const { AllProvidersFailedError } = await import("@/lib/server/providers");
    turn.mockRejectedValueOnce(new AllProvidersFailedError("down"));
    expect((await post(body)).status).toBe(503);
  });
});
