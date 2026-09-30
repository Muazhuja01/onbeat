import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/lib/memory/store";
import type { Note } from "@/lib/types";
import type { AssistResult } from "./client";
import { NOTE_MAX, noteFields } from "@/lib/profiles/notes";
import { ASSIST_PHRASES_MAX, AssistRequestSchema, type AssistRequest } from "./protocol";
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

  it("saves once when Keep is tapped twice before the first finishes", async () => {
    const { session, memory, post } = await setup([]);
    post.mockImplementationOnce(async (body) => ({
      ok: true,
      say: "Here.",
      proposals: [
        { action: "add", kind: "routine", text: "I have swimming on Fridays at 8:00.", lineIds: [userId(body)] },
        { action: "remove", noteId: "physio", lineIds: [userId(body)] },
      ],
    }));
    await session.send("Swimming on Fridays. I stopped physio.");
    const [add, remove] = session.state.cards;
    const before = memory.notes().length;

    const [a, b] = await Promise.all([session.keep(add.id), session.keep(add.id)]);
    expect([a, b].sort()).toEqual(["gone", "kept"]);
    expect(memory.notes()).toHaveLength(before + 1);

    const [c, d] = await Promise.all([session.keep(remove.id), session.keep(remove.id)]);
    expect([c, d].sort()).toEqual(["gone", "kept"]);
    expect(memory.getNote("physio")).toBeUndefined();
    expect(memory.notes()).toHaveLength(before);
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

  it("builds a card on the note text the model was sent, not the text when the answer arrives", async () => {
    const { session, memory, post } = await setup([]);
    post.mockImplementationOnce(async (body) => ({
      ok: true,
      say: "Here.",
      proposals: [{ action: "edit", kind: "routine", noteId: "physio", text: "I have physio on Thursdays at 10:30.", lineIds: [userId(body)] }],
    }));
    await session.send("Physio moved to Thursdays.");
    const first = session.state.cards[0];

    // The next request goes out with physio still on Tuesdays in its notes.
    let release!: (r: AssistResult) => void;
    let sent!: AssistRequest;
    post.mockImplementationOnce((body) => {
      sent = body;
      return new Promise((r) => (release = r));
    });
    const turn = session.send("And it's at 11 now.");
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(sent.notes.find((n) => n.id === "physio")?.text).toBe(physio.text);
    // While waiting, the user keeps the earlier card.
    expect(await session.keep(first.id)).toBe("kept");
    // The answer proposes an edit built on the Tuesdays text it was sent.
    release({ ok: true, say: "Here.", proposals: [{ action: "edit", kind: "routine", noteId: "physio", text: "I have physio on Tuesdays at 11:00.", lineIds: [userId(sent, 1)] }] });
    await turn;

    const late = session.state.cards[1];
    expect(late).toMatchObject({ action: "edit", oldText: physio.text, changed: true });
    expect(await session.keep(late.id)).toBe("changed");
    expect(memory.getNote("physio")?.text).toBe("I have physio on Thursdays at 10:30.");
  });

  it("keeps a person or place's stored name when an edit sends none", async () => {
    const { session, memory, post } = await setup([]);
    await memory.upsertNote({ id: "cafe", kind: "place", text: "Blue Door Café: my local café.", entities: ["Blue Door Café"], updatedAt: 0 });
    post.mockImplementationOnce(async (body) => ({
      ok: true,
      say: "Here.",
      proposals: [{ action: "edit", kind: "place", noteId: "cafe", text: "My local café. I go on Sundays.", lineIds: [userId(body)] }],
    }));
    await session.send("I go to Blue Door on Sundays.");
    const [card] = session.state.cards;
    expect(card.draft).toEqual({ kind: "place", name: "Blue Door Café", text: "My local café. I go on Sundays." });
    expect(await session.keep(card.id)).toBe("kept");
    const saved = memory.getNote("cafe")!;
    expect(saved.text).toBe("Blue Door Café: My local café. I go on Sundays.");
    expect(noteFields(saved).name).toBe("Blue Door Café");
  });

  it("builds a request the route accepts from long imported notes and many quick phrases", async () => {
    const { session, memory, bodies, post } = await setup([]);
    const long: Note = { id: "long", kind: "person", text: `Priya: ${"She is my pharmacist. ".repeat(24)}`.slice(0, 500), entities: ["P".repeat(200)], updatedAt: 0 };
    const many: Note[] = Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, kind: "routine", text: `Routine ${i}: ${"y".repeat(490)}`, entities: [], updatedAt: 0 }));
    const phrases = Array.from({ length: 150 }, (_, i) => ({
      id: `p${i}`,
      text: i % 10 === 0 ? `Phrase ${i} ${"z".repeat(1990)}` : `Phrase ${i}.`,
      context: { timeOfDay: "morning" as const, ...(i % 3 === 0 ? { partnerId: "long" } : {}) },
      timesUsed: 0,
      lastUsed: i,
      quick: true as const,
    }));
    await memory.replaceAll([me, physio, sam, long, ...many], phrases);
    post.mockImplementationOnce(async (body) => ({ ok: true, say: "Remove?", proposals: [{ action: "remove", noteId: "long", lineIds: [userId(body)] }] }));
    await session.send("Priya left the pharmacy.");
    await session.send("Yes.");
    for (const body of bodies) {
      const parsed = AssistRequestSchema.safeParse(body);
      expect(parsed.error?.issues ?? []).toEqual([]);
    }
    expect(bodies[0].notes.find((n) => n.id === "long")?.text).toHaveLength(NOTE_MAX);
    expect(bodies[0].phrases).toHaveLength(ASSIST_PHRASES_MAX);
    // The card keeps the whole note text, so Keep still sees the note as unchanged.
    expect(session.state.cards[0].oldText).toBe(long.text);
  });

  it("marks the line failed when building or sending the request throws", async () => {
    const { session, post } = await setup([]);
    post.mockRejectedValueOnce(new Error("offline"));
    await expect(session.send("Hello")).resolves.toBeUndefined();
    expect(session.state.lines).toEqual([expect.objectContaining({ text: "Hello", failed: true })]);
    expect(session.state.status).toBe("idle");
    await session.retry();
    expect(session.state.lines.map((l) => l.text)).toEqual(["Hello", "Anything else?"]);
  });

  it("marks the line failed when picking notes throws (the embedder offline)", async () => {
    const { session, memory, post } = await setup([]);
    vi.spyOn(memory, "searchNotes").mockRejectedValue(new Error("model not loaded"));
    await memory.replaceAll([me, ...Array.from({ length: 50 }, (_, i): Note => ({ id: `n${i}`, kind: "routine", text: "x".repeat(300), entities: [], updatedAt: 0 }))], []);
    await expect(session.send("My physio moved to Thursdays.")).resolves.toBeUndefined();
    expect(post).not.toHaveBeenCalled();
    expect(session.state).toMatchObject({ status: "idle", lines: [expect.objectContaining({ failed: true })] });
  });

  it("clears an earlier failed line once a later turn gets through", async () => {
    const { session } = await setup([{ ok: false, reason: "unavailable" }, { ok: true, say: "Got both.", proposals: [] }]);
    await session.send("Hello");
    await session.send("Are you there?");
    expect(session.state.lines.some((l) => l.failed)).toBe(false);
  });

  it("asks again when an edited draft would overwrite a note that changed since", async () => {
    const { session, memory, post } = await setup([]);
    post.mockImplementationOnce(async (body) => ({
      ok: true,
      say: "Here.",
      proposals: [{ action: "edit", kind: "routine", noteId: "physio", text: "I have physio on Thursdays at 10:30.", lineIds: [userId(body)] }],
    }));
    await session.send("Physio is Thursdays now.");
    await memory.upsertNote({ ...physio, text: "I have physio on Wednesdays at 9:00." });
    const [card] = session.state.cards;
    const draft = { kind: "routine" as const, text: "I have physio on Thursdays at 11:00." };
    expect(await session.keep(card.id, { draft })).toBe("changed");
    expect(memory.getNote("physio")?.text).toBe("I have physio on Wednesdays at 9:00.");
    // The user has now seen the notice; a second Keep of an edit saves it.
    expect(await session.keep(card.id, { draft })).toBe("kept");
    expect(memory.getNote("physio")?.text).toBe("I have physio on Thursdays at 11:00.");
  });

  it("ties a phrase to a name written with or without a full stop, and says when it isn't tied", async () => {
    const { session, memory, post } = await setup([]);
    await memory.upsertNote({ id: "chen", kind: "person", text: "Dr. Chen: my family doctor.", entities: ["Dr. Chen"], updatedAt: 0 });
    post.mockImplementationOnce(async (body) => ({
      ok: true,
      say: "Here.",
      proposals: [
        { action: "phrase", text: "Please write it down.", for: "Dr Chen", lineIds: [userId(body)] },
        { action: "phrase", text: "I get dizzy.", for: "Dr Nobody", lineIds: [userId(body)] },
      ],
    }));
    await session.send("Phrases for Dr Chen.");
    const [tied, untied] = session.state.cards;
    expect(await session.keep(tied.id)).toBe("kept");
    expect(memory.allQuickPhrases().find((p) => p.text === "Please write it down.")?.context.partnerId).toBe("chen");
    expect(session.state.cards[0].forAnyone).toBeUndefined();
    expect(await session.keep(untied.id)).toBe("kept");
    expect(session.state.cards[1].forAnyone).toBe(true);
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
