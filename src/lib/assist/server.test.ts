import { describe, expect, it, vi } from "vitest";
import type { ProviderConfig, ProviderId } from "@/lib/server/providers";
import type { AssistRequest } from "./protocol";
import { AssistUnreadableError, assistTurn } from "./server";

function sse(content: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const configs = {
  groq: { apiKey: "k", model: "m", url: "https://groq.test/v1/chat/completions" },
  cloudflare: { apiKey: "", model: "m", url: "https://cf.test" },
} as unknown as Record<ProviderId, ProviderConfig>;

const req: AssistRequest = {
  job: "update",
  today: "2026-10-05",
  lines: [
    { id: "user-aaa", speaker: "user", text: "My physio moved to Thursdays at 10:30." },
  ],
  notes: [
    { id: "note-me", kind: "about-me", text: "I'm Maya." },
    { id: "note-physio", kind: "routine", text: "I have physio on Tuesdays at 10:30." },
  ],
  phrases: [],
};

describe("assistTurn", () => {
  it("maps short ids back to real ones and checks proposals", async () => {
    const answer = JSON.stringify({
      say: "Done. Anything else?",
      proposals: [
        { action: "edit", note: "N2", kind: "routine", text: "I have physio on Thursdays at 10:30.", lines: ["U1"] },
        { action: "remove", note: "N7", lines: ["U1"] },
      ],
    });
    const fetchImpl = vi.fn(async () => sse(answer));
    const out = await assistTurn(req, { order: ["groq"], configs, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toEqual({
      say: "Done. Anything else?",
      proposals: [{ action: "edit", kind: "routine", text: "I have physio on Thursdays at 10:30.", noteId: "note-physio", lineIds: ["user-aaa"] }],
    });
  });

  it("asks once more when the answer is unreadable, then gives up", async () => {
    const fetchImpl = vi.fn(async () => sse("Sure! Here is your note."));
    await expect(assistTurn(req, { order: ["groq"], configs, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toBeInstanceOf(AssistUnreadableError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
