import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PendingSuggestion } from "@/lib/learning/types";
import type { Note } from "@/lib/types";
import { SuggestedNotes, whenSaid } from "./suggested-notes";

const now = new Date(2026, 8, 30, 16, 0);
const at = new Date(2026, 8, 30, 15, 12).getTime();
const physio: Note = { id: "physio", kind: "routine", text: "I have physio on Tuesdays at 10:30.", entities: [], updatedAt: 1 };
const add: PendingSuggestion = {
  id: "s1",
  action: "add",
  draft: { kind: "person", name: "Ana", text: "Ana is my new carer." },
  sources: [{ speaker: "user", text: "My new carer Ana starts Monday.", at }],
  createdAt: at,
};
const edit: PendingSuggestion = {
  id: "s2",
  action: "edit",
  noteId: "physio",
  oldText: physio.text,
  draft: { kind: "routine", text: "I have physio on Thursdays at 10:30." },
  sources: [{ speaker: "partner", partnerName: "Leila", text: "Your physio moved to Thursdays.", at }],
  createdAt: at,
};

function show(suggestions: PendingSuggestion[], notes: Note[] = [physio]) {
  const handlers = { onKeep: vi.fn(), onSkip: vi.fn(), onSkipAll: vi.fn(), onDone: vi.fn() };
  render(<SuggestedNotes suggestions={suggestions} notes={notes} now={now} {...handlers} />);
  return handlers;
}

describe("whenSaid", () => {
  it("says today or yesterday with the time", () => {
    expect(whenSaid(at, now)).toMatch(/^today /);
    expect(whenSaid(new Date(2026, 8, 29, 9, 0).getTime(), now)).toMatch(/^yesterday /);
    expect(whenSaid(new Date(2026, 8, 20, 9, 0).getTime(), now)).toMatch(/September/);
  });
});

describe("SuggestedNotes", () => {
  it("shows a new note with the line it came from, heading focused", () => {
    show([add]);
    expect(screen.getByRole("heading", { name: "Suggested notes" })).toHaveFocus();
    expect(screen.getByRole("heading", { name: "New note: People" })).toBeInTheDocument();
    expect(screen.getByText("Ana is my new carer.")).toBeInTheDocument();
    expect(screen.getByText(/You said: .My new carer Ana starts Monday.., today/)).toBeInTheDocument();
  });

  it("shows a change with the note as it is now and the new text", () => {
    show([edit]);
    expect(screen.getByRole("heading", { name: "Change a note: Routines" })).toBeInTheDocument();
    expect(screen.getByText("I have physio on Tuesdays at 10:30.")).toBeInTheDocument();
    expect(screen.getByText("I have physio on Thursdays at 10:30.")).toBeInTheDocument();
    expect(screen.getByText(/Leila said: .Your physio moved to Thursdays../)).toBeInTheDocument();
  });

  it("compares against the note as it is now if it changed since", () => {
    show([edit], [{ ...physio, text: "I have physio on Wednesdays." }]);
    expect(screen.getByText("I have physio on Wednesdays.")).toBeInTheDocument();
    expect(screen.queryByText("I have physio on Tuesdays at 10:30.")).toBeNull();
  });

  it("shows an edit of a deleted note as a new note", () => {
    show([edit], []);
    expect(screen.getByRole("heading", { name: "New note: Routines" })).toBeInTheDocument();
  });

  it("keeps, edits then keeps, and skips", async () => {
    const h = show([add, edit]);
    await userEvent.click(screen.getByRole("button", { name: "Keep: Ana is my new carer." }));
    expect(h.onKeep).toHaveBeenCalledWith(add, add.draft);

    await userEvent.click(screen.getByRole("button", { name: "Edit: I have physio on Thursdays at 10:30." }));
    const field = screen.getByLabelText("Routine");
    await userEvent.clear(field);
    await userEvent.type(field, "I have physio on Thursdays at 11.");
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(h.onKeep).toHaveBeenLastCalledWith(edit, { kind: "routine", text: "I have physio on Thursdays at 11." });

    await userEvent.click(screen.getByRole("button", { name: "Skip: Ana is my new carer." }));
    expect(h.onSkip).toHaveBeenCalledWith("s1");
  });

  it("asks before skipping everything", async () => {
    const h = show([add, edit]);
    await userEvent.click(screen.getByRole("button", { name: "Skip all" }));
    expect(screen.getByText("Skip all 2 suggestions?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.onSkipAll).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Skip all" }));
    await userEvent.click(screen.getByRole("button", { name: "Skip all" }));
    expect(h.onSkipAll).toHaveBeenCalled();
  });

  it("says when there is nothing to review", async () => {
    const h = show([]);
    expect(screen.getByText("Nothing to review. OnBeat suggests notes from your conversations; you choose what to keep.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip all" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(h.onDone).toHaveBeenCalled();
  });
});
