import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistResult } from "@/lib/assist/client";
import type { AssistRequest } from "@/lib/assist/protocol";
import { AssistSession, LIMIT_TEXT } from "@/lib/assist/session";
import { MemoryStore } from "@/lib/memory/store";
import { AssistantScreen } from "./assistant-screen";

async function setup(answer: (body: AssistRequest) => AssistResult | Promise<AssistResult>) {
  const memory = await MemoryStore.create();
  await memory.replaceAll(
    [
      { id: "me", kind: "about-me", text: "I'm Tom.", entities: [], updatedAt: 0, pinned: true },
      { id: "home", kind: "place", text: "Home is my flat on Oak Road.", entities: ["Home"], updatedAt: 0 },
    ],
    [],
  );
  const session = new AssistSession({ memory, post: async (b) => answer(b) });
  const props = { memory, session, onChanged: vi.fn(), onClose: vi.fn(), announce: vi.fn() };
  render(<AssistantScreen {...props} />);
  return { ...props };
}

const box = () => screen.getByLabelText("Or type what you need");

const uid = (b: AssistRequest) => b.lines.filter((l) => l.speaker === "user").at(-1)!.id;

describe("AssistantScreen", () => {
  it("starts with the jobs and says what is sent", async () => {
    await setup(() => ({ ok: true, say: "Hi.", proposals: [] }));
    expect(screen.getByRole("heading", { name: "Assistant" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Prepare for an appointment" })).toBeVisible();
    expect(screen.getByText(/sends your notes and quick phrases to the AI service/)).toBeVisible();
  });

  it("shows a phrase card and keeps it", async () => {
    const p = await setup((b) => ({ ok: true, say: "Here is one.", proposals: [{ action: "phrase", text: "Please write it down.", lineIds: [uid(b)] }] }));
    await userEvent.click(screen.getByRole("button", { name: "Make quick phrases" }));
    const keep = await screen.findByRole("button", { name: "Keep: Please write it down." });
    await waitFor(() => expect(keep).toHaveFocus());
    await userEvent.click(keep);
    await waitFor(() => expect(p.memory.allQuickPhrases().map((x) => x.text)).toEqual(["Please write it down."]));
    expect(p.onChanged).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Keep: Please write it down." })).toBeNull();
  });

  it("asks before deleting a note", async () => {
    const p = await setup((b) => ({ ok: true, say: "Remove it?", proposals: [{ action: "remove", noteId: "home", lineIds: [uid(b)] }] }));
    await userEvent.type(screen.getByLabelText("Or type what you need"), "I moved out of Oak Road.{Enter}");
    await userEvent.click(await screen.findByRole("button", { name: "Delete: Home is my flat on Oak Road." }));
    expect(screen.getByText("Delete this note?")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(p.memory.getNote("home")).toBeUndefined());
  });

  it("asks before leaving with changes not yet kept", async () => {
    const p = await setup((b) => ({ ok: true, say: "Here.", proposals: [{ action: "phrase", text: "Thank you.", lineIds: [uid(b)] }] }));
    await userEvent.click(screen.getByRole("button", { name: "Make quick phrases" }));
    await screen.findByRole("button", { name: "Keep: Thank you." });
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("Leave without keeping 1 change?")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(p.onClose).toHaveBeenCalled();
  });

  it("marks a message that wasn't sent and tries again", async () => {
    let fail = true;
    await setup(() => {
      if (fail) {
        fail = false;
        return { ok: false, reason: "unavailable" };
      }
      return { ok: true, say: "Got it.", proposals: [] };
    });
    await userEvent.type(screen.getByLabelText("Or type what you need"), "Hello{Enter}");
    expect(await screen.findByText("Not sent.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Got it.")).toBeVisible();
  });

  it("moves focus to the next card after Skip, then to the text box", async () => {
    await setup((b) => ({
      ok: true,
      say: "Two.",
      proposals: [
        { action: "phrase", text: "One.", lineIds: [uid(b)] },
        { action: "phrase", text: "Two.", lineIds: [uid(b)] },
      ],
    }));
    await userEvent.click(screen.getByRole("button", { name: "Make quick phrases" }));
    await userEvent.click(await screen.findByRole("button", { name: "Skip: One." }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Keep: Two." })).toHaveFocus());
    await userEvent.click(screen.getByRole("button", { name: "Skip: Two." }));
    await waitFor(() => expect(screen.getByLabelText("Or type what you need")).toHaveFocus());
  });

  it("returns focus to Close on Stay", async () => {
    await setup((b) => ({ ok: true, say: "Here.", proposals: [{ action: "phrase", text: "Thank you.", lineIds: [uid(b)] }] }));
    await userEvent.click(screen.getByRole("button", { name: "Make quick phrases" }));
    await screen.findByRole("button", { name: "Keep: Thank you." });
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(screen.getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toHaveFocus());
  });

  it("returns focus to Delete when the delete confirmation is cancelled", async () => {
    await setup((b) => ({ ok: true, say: "Remove it?", proposals: [{ action: "remove", noteId: "home", lineIds: [uid(b)] }] }));
    await userEvent.type(screen.getByLabelText("Or type what you need"), "Moved.{Enter}");
    await userEvent.click(await screen.findByRole("button", { name: "Delete: Home is my flat on Oak Road." }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete: Home is my flat on Oak Road." })).toHaveFocus());
  });

  it("returns focus to Edit when an edit is cancelled", async () => {
    await setup((b) => ({ ok: true, say: "Here.", proposals: [{ action: "phrase", text: "Thank you.", lineIds: [uid(b)] }] }));
    await userEvent.click(screen.getByRole("button", { name: "Make quick phrases" }));
    await userEvent.click(await screen.findByRole("button", { name: "Edit: Thank you." }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit: Thank you." })).toHaveFocus());
  });

  it("says so and keeps the card when saving fails", async () => {
    const p = await setup((b) => ({ ok: true, say: "Here.", proposals: [{ action: "phrase", text: "Thank you.", lineIds: [uid(b)] }] }));
    vi.spyOn(p.memory, "addQuickPhrase").mockRejectedValue(new Error("disk full"));
    await userEvent.click(screen.getByRole("button", { name: "Make quick phrases" }));
    await userEvent.click(await screen.findByRole("button", { name: "Keep: Thank you." }));
    await waitFor(() => expect(p.announce).toHaveBeenCalledWith("Couldn't save that. Try again."));
    expect(p.onChanged).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Keep: Thank you." })).toHaveFocus());
  });

  it("moves focus to the text box when a job is chosen", async () => {
    await setup(() => new Promise<AssistResult>(() => {}));
    await userEvent.click(screen.getByRole("button", { name: "Update my information" }));
    await waitFor(() => expect(box()).toHaveFocus());
  });

  it("says a message wasn't sent and moves focus to Try again", async () => {
    const p = await setup(() => ({ ok: false, reason: "unavailable" }));
    await userEvent.click(screen.getByRole("button", { name: "Make quick phrases" }));
    await waitFor(() => expect(p.announce).toHaveBeenCalledWith("Not sent. Try again."));
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus());
  });

  it("prefills Edit from the note as it is now once it has changed", async () => {
    const p = await setup((b) => ({ ok: true, say: "Here.", proposals: [{ action: "edit", kind: "place", noteId: "home", text: "My flat on Elm Road.", lineIds: [uid(b)] }] }));
    await userEvent.type(box(), "I moved to Elm Road.{Enter}");
    await screen.findByRole("button", { name: /^Keep: Home: My flat on Elm Road/ });
    await p.memory.upsertNote({ id: "home", kind: "place", text: "Home: my house on Birch Lane.", entities: ["Home"], updatedAt: 1 });
    await userEvent.click(screen.getByRole("button", { name: /^Keep: Home/ }));
    await waitFor(() => expect(p.announce).toHaveBeenCalledWith("This note has changed since."));
    await userEvent.click(screen.getByRole("button", { name: /^Edit: Home/ }));
    expect(screen.getByLabelText("Name")).toHaveValue("Home");
    expect(screen.getByLabelText("A few words about it")).toHaveValue("my house on Birch Lane.");
  });

  it("says a note is no longer there", async () => {
    const p = await setup((b) => ({ ok: true, say: "Here.", proposals: [{ action: "edit", kind: "place", noteId: "home", text: "My flat on Elm Road.", lineIds: [uid(b)] }] }));
    await userEvent.type(box(), "I moved to Elm Road.{Enter}");
    const keep = await screen.findByRole("button", { name: /^Keep: Home/ });
    await p.memory.removeNote("home");
    await userEvent.click(keep);
    await waitFor(() => expect(p.announce).toHaveBeenCalledWith("This note is no longer there."));
  });

  it("gives the delete confirmation a heading", async () => {
    await setup((b) => ({ ok: true, say: "Remove it?", proposals: [{ action: "remove", noteId: "home", lineIds: [uid(b)] }] }));
    await userEvent.type(box(), "Moved.{Enter}");
    await userEvent.click(await screen.findByRole("button", { name: "Delete: Home is my flat on Oak Road." }));
    expect(screen.getByRole("heading", { level: 3, name: "Delete this note?" })).toBeVisible();
  });

  it("says a phrase was kept for anyone when its person isn't found", async () => {
    const p = await setup((b) => ({ ok: true, say: "Here.", proposals: [{ action: "phrase", text: "Thank you.", for: "Dr Nobody", lineIds: [uid(b)] }] }));
    await userEvent.click(screen.getByRole("button", { name: "Make quick phrases" }));
    await userEvent.click(await screen.findByRole("button", { name: "Keep: Thank you." }));
    await waitFor(() => expect(p.announce).toHaveBeenCalledWith("Kept, for anyone"));
  });

  it("announces the answer and the limit together at message 20, then focuses the heading", async () => {
    const p = await setup(() => ({ ok: true, say: "Got it.", proposals: [] }));
    for (let i = 0; i < 19; i++) await act(() => p.session.send(`Message ${i}`));
    await userEvent.type(box(), "Last one.{Enter}");
    await waitFor(() => expect(p.announce).toHaveBeenLastCalledWith(`Got it. ${LIMIT_TEXT}`));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Assistant" })).toHaveFocus());
  });
});

describe("AssistantScreen under StrictMode", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("still sends after the development remount", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ say: "Hello back.", proposals: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const memory = await MemoryStore.create();
    render(
      <StrictMode>
        <AssistantScreen memory={memory} onChanged={vi.fn()} onClose={vi.fn()} announce={vi.fn()} />
      </StrictMode>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Make quick phrases" }));
    expect(await screen.findByText("Hello back.")).toBeVisible();
    expect(fetchMock).toHaveBeenCalled();
  });
});
