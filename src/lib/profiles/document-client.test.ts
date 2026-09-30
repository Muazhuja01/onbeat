import { describe, expect, it, vi } from "vitest";
import { notesFromDocument } from "./document-client";

const file = new File(["I'm Maya."], "me.txt");
const reply = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe("notesFromDocument", () => {
  it("returns the notes", async () => {
    const r = await notesFromDocument(file, reply(200, { notes: [{ kind: "about-me", text: "Hi" }], truncated: false }));
    expect(r).toEqual({ ok: true, notes: [{ kind: "about-me", text: "Hi" }], truncated: false });
  });

  it("checks size and type before sending", async () => {
    const f = vi.fn();
    expect(await notesFromDocument(new File(["x"], "a.doc"), f)).toMatchObject({ ok: false, message: expect.stringContaining("Word (.docx)") });
    expect(await notesFromDocument(new File([new Uint8Array(4 * 1024 * 1024 + 1)], "a.pdf"), f)).toMatchObject({
      ok: false,
      message: expect.stringContaining("4 MB"),
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("explains each failure in plain words", async () => {
    expect(await notesFromDocument(file, reply(422, { error: "no_text" }))).toMatchObject({ message: expect.stringContaining("couldn't find any text") });
    expect(await notesFromDocument(file, reply(503, { error: "unavailable" }))).toMatchObject({ message: expect.stringContaining("try again") });
    expect(await notesFromDocument(file, reply(429, { error: "rate_limited" }))).toMatchObject({ message: expect.stringContaining("minute") });
    expect(await notesFromDocument(file, vi.fn().mockResolvedValue(new Response("<html>", { status: 500 })))).toMatchObject({ ok: false });
    expect(await notesFromDocument(file, vi.fn().mockRejectedValue(new TypeError("offline")))).toMatchObject({ message: expect.stringContaining("connection") });
  });

  it("says when nothing useful was found", async () => {
    expect(await notesFromDocument(file, reply(200, { notes: [], truncated: false }))).toMatchObject({ ok: false, message: expect.stringContaining("No notes") });
  });
});
