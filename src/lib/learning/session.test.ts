import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/lib/memory/store";
import { memoryKeyValue } from "@/lib/profiles/kv";
import type { Note } from "@/lib/types";
import { QUIET_MS } from "./batcher";
import type { LearnResult } from "./client";
import { PendingStore } from "./pending";
import type { LearnRequest, Proposal } from "./protocol";
import { LearningSession } from "./session";

const notes: Note[] = [
  { id: "me", kind: "about-me", text: "I'm Maya. I type to talk.", entities: ["Maya"], updatedAt: 0, pinned: true },
  { id: "physio", kind: "routine", text: "I have physio on Tuesdays at 10:30.", entities: [], updatedAt: 0 },
  { id: "sam", kind: "person", text: "Sam is the barista at Blue Door Café.", entities: ["Sam", "Blue Door Café"], updatedAt: 0 },
];

type Post = (body: LearnRequest) => Promise<LearnResult>;
const answer = (make: (body: LearnRequest) => Proposal[]) => vi.fn<Post>(async (body) => ({ ok: true, proposals: make(body) }));

async function open(post: Post, opts: { enabled?: boolean; kv?: ReturnType<typeof memoryKeyValue>; profileId?: string } = {}) {
  const memory = await MemoryStore.create();
  await memory.replaceAll(notes, []);
  const kv = opts.kv ?? memoryKeyValue();
  const session = await LearningSession.open({ kv, profileId: opts.profileId ?? "p1", memory, enabled: opts.enabled ?? true, post });
  return { session, memory, kv };
}

async function talk(session: LearningSession) {
  await session.addLine({ speaker: "partner", text: "Your physio moved to Thursdays, same time.", partnerName: "Leila", placeName: "Home" });
  await session.addLine({ speaker: "user", text: "OK, thank you." });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("LearningSession", () => {
  it("sends a quiet batch with the pinned note and the notes the lines relate to", async () => {
    const post = answer(() => []);
    const { session } = await open(post);
    await talk(session);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(post).toHaveBeenCalledTimes(1);
    const body = post.mock.calls[0][0];
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.lines.map((l) => [l.speaker, l.text, l.partnerName, l.placeName])).toEqual([
      ["partner", "Your physio moved to Thursdays, same time.", "Leila", "Home"],
      ["user", "OK, thank you.", undefined, undefined],
    ]);
    const sentIds = body.notes.map((n) => n.id);
    expect(sentIds[0]).toBe("me");
    expect(sentIds).toContain("physio");
    expect(sentIds.length).toBeLessThanOrEqual(9);
  });

  it("turns proposals into suggestions that quote their lines", async () => {
    const post = answer((body) => [{ action: "edit", kind: "routine", noteId: "physio", text: "I have physio on Thursdays at 10:30.", lineIds: [body.lines[0].id] }]);
    const { session } = await open(post);
    await talk(session);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(session.pending.list()).toMatchObject([
      {
        action: "edit",
        noteId: "physio",
        oldText: "I have physio on Tuesdays at 10:30.",
        draft: { kind: "routine", text: "I have physio on Thursdays at 10:30." },
        sources: [{ speaker: "partner", text: "Your physio moved to Thursdays, same time.", partnerName: "Leila" }],
      },
    ]);
  });

  it("an edit of a person keeps their name, and an edit of a deleted note becomes a new note", async () => {
    const post = answer((body) => [
      { action: "edit", kind: "person", noteId: "sam", text: "moving to Leeds in May", lineIds: [body.lines[0].id] },
      { action: "edit", kind: "routine", noteId: "gone", text: "Swimming on Fridays.", lineIds: [body.lines[0].id] },
    ]);
    const { session } = await open(post);
    await talk(session);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    const [sam, swim] = session.pending.list();
    expect(sam).toMatchObject({ action: "edit", noteId: "sam", draft: { kind: "person", name: "Sam", text: "moving to Leeds in May" } });
    expect(swim.action).toBe("add");
    expect(swim).not.toHaveProperty("noteId");
  });

  it("keeps the lines when the service is busy and sends them again later", async () => {
    const post = vi.fn<Post>(async () => ({ ok: false, retry: true }));
    const { session } = await open(post);
    await talk(session);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][0].lines.map((l) => l.text)).toEqual(post.mock.calls[0][0].lines.map((l) => l.text));
  });

  it("drops a batch the server refused", async () => {
    const post = vi.fn<Post>(async () => ({ ok: false, retry: false }));
    const { session } = await open(post);
    await talk(session);
    await vi.advanceTimersByTimeAsync(QUIET_MS * 3);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("queues nothing while off, and empties the queue when turned off", async () => {
    const post = answer(() => []);
    const { session } = await open(post, { enabled: false });
    await talk(session);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(post).not.toHaveBeenCalled();

    await session.setEnabled(true);
    await talk(session);
    await session.setEnabled(false);
    await session.setEnabled(true);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(post).not.toHaveBeenCalled();
  });

  it("ignores empty lines and sends when the page is hidden", async () => {
    const post = answer(() => []);
    const { session } = await open(post);
    await session.addLine({ speaker: "user", text: "   " });
    await talk(session);
    session.pageHidden();
    await vi.advanceTimersByTimeAsync(0);
    expect(post.mock.calls[0][0].lines).toHaveLength(2);
  });

  it("writes a late result to the profile it was sent for", async () => {
    let release!: (r: LearnResult) => void;
    const post = vi.fn<Post>(() => new Promise<LearnResult>((r) => (release = r)));
    const kv = memoryKeyValue();
    const { session } = await open(post, { kv, profileId: "p1" });
    await talk(session);
    session.pageHidden();
    await vi.advanceTimersByTimeAsync(0);
    session.dispose();
    const lineId = post.mock.calls[0][0].lines[0].id;
    release({ ok: true, proposals: [{ action: "add", kind: "preference", text: "I like green tea.", lineIds: [lineId] }] });
    await vi.advanceTimersByTimeAsync(0);
    expect((await PendingStore.open(kv, "p1")).list()).toHaveLength(1);
    expect((await PendingStore.open(kv, "p2")).list()).toHaveLength(0);
  });
});
