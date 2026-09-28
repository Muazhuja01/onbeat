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
