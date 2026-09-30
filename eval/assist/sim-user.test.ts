import { describe, expect, it } from "vitest";
import { askSimUser, chatAsUser, parseSimReply, SIM_MODEL, simUserMessages } from "./sim-user";

describe("simulated user", () => {
  it("sees the brief and the chat from the user's side", () => {
    const [, user] = simUserMessages("You want phrases for Sam.", [
      { speaker: "user", text: "Make quick phrases" },
      { speaker: "assistant", text: "Who are they for?" },
    ]);
    expect(user.content).toContain("You want phrases for Sam.");
    expect(user.content).toContain("Assistant: Who are they for?");
    expect(user.content).toContain("You: Make quick phrases");
  });

  it("is told not to leave before saying everything its brief wants", () => {
    const [, user] = simUserMessages("You want phrases for Sam.", []);
    expect(user.content).toContain("Don't say goodbye until you've told the assistant everything your brief says you want.");
  });

  it("reads a reply and the done marker", () => {
    expect(parseSimReply("  Sam at the café  ")).toEqual({ text: "Sam at the café", done: false });
    expect(parseSimReply("That's all, thanks [done]")).toEqual({ text: "That's all, thanks", done: true });
    expect(parseSimReply("[done]")).toEqual({ text: "", done: true });
  });
});

describe("askSimUser", () => {
  const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: "Thursdays" } }] }), { status: 200 });

  it("asks gpt-oss on Groq a little warmer than the judge, with low reasoning", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return ok();
    }) as unknown as typeof fetch;
    const cooldown = { isCooling: () => false, block: () => {} };
    const text = await askSimUser([{ role: "user", content: "hi" }], { apiKey: "k", cooldown, fetchImpl });
    expect(text).toBe("Thursdays");
    expect(calls[0].url).toContain("api.groq.com");
    expect(calls[0].body).toMatchObject({ model: SIM_MODEL, temperature: 0.3, reasoning_effort: "low" });
  });

  it("records a 429's wait on the cooldown so withRetry waits and tries again", async () => {
    const fetchImpl = (async () => new Response("", { status: 429, headers: { "retry-after": "7" } })) as unknown as typeof fetch;
    const blocked: number[] = [];
    const cooldown = { isCooling: () => false, block: (_id: string, ms: number) => void blocked.push(ms) };
    await expect(askSimUser([{ role: "user", content: "hi" }], { apiKey: "k", cooldown, fetchImpl })).rejects.toThrow("429");
    expect(blocked).toEqual([7000]);
  });
});

describe("askSimUser with no reply", () => {
  it("fails the case instead of ending the chat as if the user were done", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ choices: [{ message: { content: null }, finish_reason: "length" }] }), { status: 200 })) as unknown as typeof fetch;
    const cooldown = { isCooling: () => false, block: () => {} };
    await expect(askSimUser([{ role: "user", content: "hi" }], { apiKey: "k", cooldown, fetchImpl })).rejects.toThrow("simulated user: empty reply (finish_reason: length)");
  });
});

describe("chatAsUser", () => {
  const run = async (replies: string[], turns = 7) => {
    const sent: string[] = [];
    let i = 0;
    await chatAsUser("brief", turns, { lines: () => [], ask: async () => replies[i++] ?? "[done]", send: async (t) => void sent.push(t) });
    return { sent, asked: i };
  };

  it("sends a goodbye before stopping, so the assistant answers it", async () => {
    expect(await run(["Thursdays", "Nothing, bye [done]", "never asked"])).toEqual({ sent: ["Thursdays", "Nothing, bye"], asked: 2 });
  });

  it("stops without sending on a bare done marker", async () => {
    expect(await run(["[done]"])).toEqual({ sent: [], asked: 1 });
  });

  it("stops after the given number of replies", async () => {
    expect(await run(["a", "b", "c"], 2)).toEqual({ sent: ["a", "b"], asked: 2 });
  });
});
