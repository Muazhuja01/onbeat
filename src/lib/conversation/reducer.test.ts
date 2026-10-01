import { describe, expect, it } from "vitest";
import { conversationReducer as r, initialConversation as s0, PAUSED_NOTICE } from "./reducer";
import type { Reply } from "@/lib/types";

const reply = (text: string): Reply => ({ text, noteIds: [], source: "model" });

describe("conversationReducer", () => {
  it("adds partner turns and ignores blank ones", () => {
    const s1 = r(s0, { type: "partnerSaid", id: "1", text: "  What size?  ", at: 1 });
    expect(s1.turns).toEqual([{ id: "1", speaker: "partner", text: "What size?", at: 1 }]);
    expect(r(s1, { type: "partnerSaid", id: "2", text: "   ", at: 2 })).toBe(s1);
  });

  it("shows suggestions and marks them ready", () => {
    const s1 = r(s0, { type: "suggestions", replies: [reply("A")], reactions: [], done: false, hold: false });
    expect(s1.replies).toEqual([reply("A")]);
    expect(s1.status).toBe("ready");
  });

  it("holds new suggestions while the user is aiming, then releases them", () => {
    const s1 = r(s0, { type: "suggestions", replies: [reply("A")], reactions: [], done: true, hold: false });
    const s2 = r(s1, { type: "suggestions", replies: [reply("B")], reactions: [], done: true, hold: true });
    expect(s2.replies).toEqual([reply("A")]);
    expect(s2.heldReplies).toEqual([reply("B")]);
    const s3 = r(s2, { type: "releaseHeld" });
    expect(s3.replies).toEqual([reply("B")]);
    expect(s3.heldReplies).toBeNull();
  });

  it("remembers when the replies on screen were asked for, through a hold and release", () => {
    const s1 = r(s0, { type: "suggestions", replies: [reply("A")], reactions: [], done: true, hold: false, askedAt: 100 });
    expect(s1.repliesAskedAt).toBe(100);
    const s2 = r(s1, { type: "suggestions", replies: [reply("B")], reactions: [], done: true, hold: true, askedAt: 200 });
    expect(s2.repliesAskedAt).toBe(100);
    expect(r(s2, { type: "releaseHeld" }).repliesAskedAt).toBe(200);
    const local = r(s1, { type: "suggestions", replies: [{ text: "Hi", noteIds: [], source: "phrase" }], reactions: [], done: false, hold: false });
    expect(local.repliesAskedAt).toBeNull();
  });

  it("does not hold when nothing is on screen yet", () => {
    const s1 = r(s0, { type: "suggestions", replies: [reply("A")], reactions: [], done: false, hold: true });
    expect(s1.replies).toEqual([reply("A")]);
  });

  it("pauses when suggestions are unavailable and recovers on the next attempt", () => {
    const s1 = r(s0, { type: "unavailable" });
    expect(s1.status).toBe("paused");
    expect(s1.notice).toBe(PAUSED_NOTICE);
    const s2 = r(s1, { type: "thinking" });
    expect(s2.notice).toBeNull();
    expect(s2.status).toBe("thinking");
  });

  it("keeps the paused notice through a speculative attempt and clears it when model replies arrive", () => {
    const s1 = r(s0, { type: "unavailable" });
    expect(r(s1, { type: "thinking", speculative: true })).toBe(s1);
    const phrase = r(s1, { type: "suggestions", replies: [{ text: "Hi", noteIds: [], source: "phrase" }], reactions: [], done: false, hold: false });
    expect(phrase.notice).toBe(PAUSED_NOTICE);
    const model = r(s1, { type: "suggestions", replies: [reply("A")], reactions: [], done: true, hold: false });
    expect(model.notice).toBeNull();
    expect(model.status).toBe("ready");
  });

  it("records spoken lines and clears matching typed text", () => {
    const s1 = r({ ...s0, typed: "Large please " }, { type: "speakStart", id: "u1", text: "Large please", at: 5 });
    expect(s1.speaking).toBe("Large please");
    expect(s1.lastSpoken).toBe("Large please");
    expect(s1.typed).toBe("");
    expect(s1.turns.at(-1)).toEqual({ id: "u1", speaker: "user", text: "Large please", at: 5 });
    const s2 = r(s1, { type: "speakEnd", text: "Large please" });
    expect(s2.speaking).toBeNull();
    expect(s2.lastSpoken).toBe("Large please");
  });

  it("keeps at most 50 turns", () => {
    let s = s0;
    for (let i = 0; i < 60; i++) s = r(s, { type: "partnerSaid", id: String(i), text: `t${i}`, at: i });
    expect(s.turns).toHaveLength(50);
    expect(s.turns[0].text).toBe("t10");
  });

  it("reset keeps the context", () => {
    const s1 = r(r(s0, { type: "setContext", placeId: "p", partnerId: "q" }), { type: "partnerSaid", id: "1", text: "Hi", at: 1 });
    const s2 = r(s1, { type: "reset" });
    expect(s2.turns).toEqual([]);
    expect(s2.placeId).toBe("p");
  });

  it("a cancelled request leaves status alone unless it was stuck thinking", () => {
    expect(r(s0, { type: "cancelled" })).toBe(s0);

    const thinking = r(s0, { type: "thinking" });
    expect(thinking.status).toBe("thinking");
    expect(r(thinking, { type: "cancelled" }).status).toBe("idle");

    const thinkingWithReplies = { ...s0, status: "thinking" as const, replies: [reply("A")] };
    expect(r(thinkingWithReplies, { type: "cancelled" }).status).toBe("ready");
  });

  it("shows the partner's words while they talk and clears them when the turn ends", () => {
    let s = r(s0, { type: "partnerPartial", text: " What size " });
    expect(s.partnerPartial).toBe("What size");
    s = r(s, { type: "partnerSaid", id: "1", text: "What size would you like?", at: 1 });
    expect(s.partnerPartial).toBe("");
    expect(s.turns.at(-1)?.text).toBe("What size would you like?");
    s = r({ ...s, partnerPartial: "Hello" }, { type: "reset" });
    expect(s.partnerPartial).toBe("");
  });
});

describe("joining the partner's pauses into one line", () => {
  const heard = (id: string, text: string, startedAt: number, endedAt: number, join = true) =>
    ({ type: "partnerSaid", id, text, at: endedAt, heard: { startedAt, endedAt }, join }) as const;
  const first = r(s0, heard("1", "So the physio", 1_000, 2_000));

  it("adds speech that starts within 3 s of the last heard line to that line", () => {
    const s = r(first, heard("2", " moved to Thursdays ", 5_000, 6_500));
    expect(s.turns).toEqual([{ id: "1", speaker: "partner", text: "So the physio moved to Thursdays", at: 2_000, endedAt: 6_500 }]);
    // Measured from the end of the line as it is now.
    const s2 = r(s, heard("3", "is that OK?", 9_400, 10_000));
    expect(s2.turns).toHaveLength(1);
    expect(s2.turns[0].text).toBe("So the physio moved to Thursdays is that OK?");
  });

  it("starts a new line when the speech starts more than 3 s after it", () => {
    const s = r(first, heard("2", "Anything else?", 5_001, 6_000));
    expect(s.turns.map((t) => t.text)).toEqual(["So the physio", "Anything else?"]);
  });

  it("starts a new line after a line from the user", () => {
    const s = r(r(first, { type: "speakStart", id: "u1", text: "Sorry?", at: 2_500 }), heard("2", "moved to Thursdays", 3_000, 4_000));
    expect(s.turns.map((t) => t.text)).toEqual(["So the physio", "Sorry?", "moved to Thursdays"]);
  });

  it("starts a new line with the setting off", () => {
    const s = r(first, heard("2", "moved to Thursdays", 3_000, 4_000, false));
    expect(s.turns.map((t) => t.text)).toEqual(["So the physio", "moved to Thursdays"]);
  });

  it("never joins a typed line, or onto one", () => {
    const typed = r(first, { type: "partnerSaid", id: "2", text: "moved to Thursdays", at: 2_100 });
    expect(typed.turns.map((t) => t.text)).toEqual(["So the physio", "moved to Thursdays"]);
    const after = r(typed, heard("3", "is that OK?", 2_200, 3_000));
    expect(after.turns.map((t) => t.text)).toEqual(["So the physio", "moved to Thursdays", "is that OK?"]);
  });

  it("starts a new line when the start of the speech is unknown", () => {
    const s = r(first, { type: "partnerSaid", id: "2", text: "moved", at: 2_500, heard: { endedAt: 2_500 }, join: true });
    expect(s.turns).toHaveLength(2);
  });

  it("never joins across a cleared conversation", () => {
    const s = r(r(first, { type: "reset" }), heard("2", "moved to Thursdays", 3_000, 4_000));
    expect(s.turns).toEqual([{ id: "2", speaker: "partner", text: "moved to Thursdays", at: 4_000, endedAt: 4_000 }]);
  });

  it("says when the words still being heard will join the last line", () => {
    const partial = (text: string, startedAt: number | undefined, join = true) => ({ type: "partnerPartial", text, startedAt, join }) as const;
    expect(r(first, partial("moved to", 3_000)).partialJoins).toBe(true);
    expect(r(first, partial("moved to", 5_500)).partialJoins).toBe(false);
    expect(r(first, partial("moved to", 3_000, false)).partialJoins).toBe(false);
    expect(r(first, partial("moved to", undefined)).partialJoins).toBe(false);
    const joining = r(first, partial("moved to", 3_000));
    expect(r(joining, partial("", 3_000)).partialJoins).toBe(false);
    expect(r(joining, heard("2", "moved to Thursdays", 3_000, 4_000)).partialJoins).toBe(false);
  });
});
