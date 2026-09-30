import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/lib/memory/store";
import type { Note } from "@/lib/types";
import type { AssistResult } from "./client";
import type { AssistRequest } from "./protocol";
import { AssistSession, LIMIT_TEXT, SORRY } from "./session";

const me: Note = { id: "me", kind: "about-me", text: "I'm Maya.", entities: [], updatedAt: 0, pinned: true };
const physio: Note = { id: "physio", kind: "routine", text: "I have physio on Tuesdays at 10:30.", entities: [], updatedAt: 0 };
const sam: Note = { id: "sam", kind: "person", text: "Sam is the barista at Blue Door Café.", entities: ["Sam"], updatedAt: 0 };

async function setup(answers: AssistResult[]) {
  const memory = await MemoryStore.create();
  await memory.replaceAll([me, physio, sam], []);
  const bodies: AssistRequest[] = [];
  const post = vi.fn(async (body: AssistRequest) => {
    bodies.push(body);
    return answers.shift() ?? { ok: true as const, say: "Anything else?", proposals: [] };
  });
  const session = new AssistSession({ memory, post, now: () => new Date(2026, 9, 5, 12).getTime() });
  return { memory, session, post, bodies };
}

const userId = (b: AssistRequest, i = 0) => b.lines.filter((l) => l.speaker === "user")[i].id;

describe("AssistSession", () => {
  it("starts a job with its button text and shows the answer", async () => {
    const { session, bodies } = await setup([{ ok: true, say: "What changed?", proposals: [] }]);
    await session.chooseJob("update");
    expect(bodies[0].job).toBe("update");
    expect(bodies[0].today).toBe("2026-10-05");
    expect(bodies[0].lines).toEqual([{ id: expect.any(String), speaker: "user", text: "Update my information" }]);
    expect(session.state.lines.map((l) => l.text)).toEqual(["Update my information", "What changed?"]);
  });

  it("makes cards, keeps an edit, and tells the model what it already proposed", async () => {
    const { session, memory, bodies, post } = await setup([]);
    post.mockImplementationOnce(async (body) => ({
      ok: true,
      say: "Here is the change.",
      proposals: [{ action: "edit", kind: "routine", noteId: "physio", text: "I have physio on Thursdays at 10:30.", lineIds: [userId(body)] }],
    }));
    await session.send("My physio moved to Thursdays.");
    const [card] = session.state.cards;
    expect(card).toMatchObject({ action: "edit", noteId: "physio", oldText: physio.text, sources: ["My physio moved to Thursdays."], state: "open" });
    expect(await session.keep(card.id)).toBe("kept");
    expect(memory.getNote("physio")?.text).toBe("I have physio on Thursdays at 10:30.");
    expect(await session.keep(card.id)).toBe("gone");
    await session.send("That's all.");
    expect(bodies.at(-1)!.lines[1].proposed).toEqual(['change "I have physio on Thursdays at 10:30."']);
  });

  it("won't overwrite a note that changed since the card was made", async () => {
    const { session, memory, post } = await setup([]);
    post.mockImplementationOnce(async (body) => ({
      ok: true,
      say: "Here.",
      proposals: [{ action: "edit", kind: "routine", noteId: "physio", text: "I have physio on Thursdays at 10:30.", lineIds: [userId(body)] }],
    }));
    await session.send("Physio is Thursdays now.");
    await memory.upsertNote({ ...physio, text: "I have physio on Wednesdays at 9:00." });
    const [card] = session.state.cards;
    expect(await session.keep(card.id)).toBe("changed");
    expect(memory.getNote("physio")?.text).toBe("I have physio on Wednesdays at 9:00.");
    expect(session.state.cards[0]).toMatchObject({ state: "open", changed: true });
    expect(await session.keep(card.id, { draft: { kind: "routine", text: "I have physio on Thursdays at 9:00." } })).toBe("kept");
    expect(memory.getNote("physio")?.text).toBe("I have physio on Thursdays at 9:00.");
  });

  it("removes a note, never offers removing the about-me note", async () => {
    const { session, memory, post } = await setup([]);
    post.mockImplementationOnce(async (body) => ({
      ok: true,
      say: "Removed?",
      proposals: [
        { action: "remove", noteId: "me", lineIds: [userId(body)] },
        { action: "remove", noteId: "physio", lineIds: [userId(body)] },
      ],
    }));
    await session.send("I stopped physio.");
    expect(session.state.cards.map((c) => c.noteId)).toEqual(["physio"]);
    expect(await session.keep(session.state.cards[0].id)).toBe("kept");
    expect(memory.getNote("physio")).toBeUndefined();
  });

  it("ties a phrase to a person kept earlier in the same chat", async () => {
    const { session, memory, post } = await setup([]);
    post.mockImplementationOnce(async (body) => ({
      ok: true,
      say: "Here.",
      proposals: [
        { action: "add", kind: "person", name: "Dr. Patel", text: "Dr. Patel is my new dentist.", lineIds: [userId(body)] },
        { action: "phrase", text: "I can't keep my mouth open for long.", for: "Dr. Patel", lineIds: [userId(body)] },
      ],
    }));
    await session.send("New dentist, Dr. Patel. I can't keep my mouth open for long.");
    const [person, phrase] = session.state.cards;
    await session.keep(person.id);
    expect(await session.keep(phrase.id)).toBe("kept");
    const patel = memory.notes().find((n) => n.entities.includes("Dr. Patel"))!;
    expect(memory.allQuickPhrases()[0].context.partnerId).toBe(patel.id);
  });

  it("says a phrase or note already exists", async () => {
    const { session, memory, post } = await setup([]);
    await memory.addQuickPhrase("My usual, please.", {});
    post.mockImplementationOnce(async (body) => ({ ok: true, say: "Here.", proposals: [{ action: "phrase", text: "My usual please", lineIds: [userId(body)] }] }));
    await session.send("A phrase for my usual order.");
    expect(await session.keep(session.state.cards[0].id)).toBe("duplicate");
    expect(session.state.cards[0].state).toBe("skipped");
  });

  it("marks a line that couldn't be sent, and retries it without a new line", async () => {
    const { session, post } = await setup([{ ok: false, reason: "unavailable" }, { ok: true, say: "Got it.", proposals: [] }]);
    await session.send("Hello");
    expect(session.state.lines).toEqual([expect.objectContaining({ text: "Hello", failed: true })]);
    await session.retry();
    expect(session.state.lines.map((l) => [l.text, !!l.failed])).toEqual([
      ["Hello", false],
      ["Got it.", false],
    ]);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("says sorry for an unreadable answer", async () => {
    const { session } = await setup([{ ok: false, reason: "unreadable" }]);
    await session.send("Hello");
    expect(session.state.lines.at(-1)?.text).toBe(SORRY);
  });

  it("ignores an answer that arrives after closing", async () => {
    const { session, post } = await setup([]);
    let release!: (r: AssistResult) => void;
    post.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const sent = session.send("Hello");
    await vi.waitFor(() => expect(release).toBeDefined());
    session.close();
    release({ ok: true, say: "Late.", proposals: [] });
    await sent;
    expect(session.state.lines.map((l) => l.text)).toEqual(["Hello"]);
  });

  it("stops at 20 user messages", async () => {
    const { session, post } = await setup([]);
    for (let i = 0; i < 21; i++) await session.send(`Message ${i}`);
    expect(post).toHaveBeenCalledTimes(20);
    expect(session.state.lines.at(-1)?.text).toBe(LIMIT_TEXT);
  });

  it("drops a card identical to an earlier one", async () => {
    const { session, post } = await setup([]);
    const phrase = (body: AssistRequest) => ({ ok: true as const, say: "Here.", proposals: [{ action: "phrase" as const, text: "Thank you.", lineIds: [userId(body)] }] });
    post.mockImplementationOnce(async (b) => phrase(b)).mockImplementationOnce(async (b) => phrase(b));
    await session.send("A thank you phrase.");
    await session.send("Again?");
    expect(session.state.cards).toHaveLength(1);
  });
});
