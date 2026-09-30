import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AssistResult } from "@/lib/assist/client";
import type { AssistRequest } from "@/lib/assist/protocol";
import { AssistSession } from "@/lib/assist/session";
import { MemoryStore } from "@/lib/memory/store";
import { AssistantScreen } from "./assistant-screen";

async function setup(answer: (body: AssistRequest) => AssistResult) {
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
    await userEvent.type(screen.getByLabelText("Message to the assistant"), "I moved out of Oak Road.{Enter}");
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
    await userEvent.type(screen.getByLabelText("Message to the assistant"), "Hello{Enter}");
    expect(await screen.findByText("Not sent.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Got it.")).toBeVisible();
  });
});
