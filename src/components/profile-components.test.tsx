import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/types";
import { DocumentImport } from "./document-import";
import { NoteForm } from "./note-form";
import { NotesEditor } from "./notes-editor";

describe("NoteForm", () => {
  it("needs a name for a person and saves both fields", async () => {
    const onSave = vi.fn();
    render(<NoteForm kind="person" submitLabel="Add person" onSave={onSave} />);
    const add = screen.getByRole("button", { name: "Add person" });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Name"), "Sam");
    await userEvent.type(screen.getByLabelText("Who they are to you"), "My barista");
    await userEvent.click(add);
    expect(onSave).toHaveBeenCalledWith({ kind: "person", name: "Sam", text: "My barista" });
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("counts the characters left, leaving room for the name", async () => {
    render(<NoteForm kind="place" submitLabel="Add place" onSave={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Name"), "Home");
    expect(screen.getByText("294 characters left")).toBeInTheDocument();
    expect(screen.getByLabelText("A few words about it")).toHaveAttribute("maxLength", "294");
  });
});

const notes: Note[] = [
  { id: "me", kind: "about-me", text: "I'm Maya.", entities: ["Maya"], updatedAt: 1, pinned: true },
  { id: "sam", kind: "person", text: "Sam: my barista", entities: ["Sam"], updatedAt: 1 },
];

describe("NotesEditor", () => {
  it("groups notes and marks the main one", () => {
    render(<NotesEditor notes={notes} onSave={vi.fn()} onRemove={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Your notes" })).toHaveFocus();
    const about = screen.getByRole("region", { name: "About you" });
    expect(within(about).getByText("Sent with every reply")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "People" })).getByText("Sam: my barista")).toBeInTheDocument();
  });

  it("edits a note in place, keeping its id and pin", async () => {
    const onSave = vi.fn();
    render(<NotesEditor notes={notes} onSave={onSave} onRemove={vi.fn()} onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit: Sam: my barista" }));
    const text = screen.getByLabelText("Who they are to you");
    expect(text).toHaveValue("my barista");
    await userEvent.clear(text);
    await userEvent.type(text, "the barista at Blue Door Café");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: "sam", text: "Sam: the barista at Blue Door Café" });
    expect(screen.getByRole("button", { name: "Edit: Sam: my barista" })).toHaveFocus();
  });

  it("asks before deleting", async () => {
    const onRemove = vi.fn();
    render(<NotesEditor notes={notes} onSave={vi.fn()} onRemove={onRemove} onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete: Sam: my barista" }));
    expect(onRemove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onRemove).toHaveBeenCalledWith("sam");
    expect(screen.getByRole("button", { name: "Add a person" })).toHaveFocus();
  });

  it("adds a routine", async () => {
    const onSave = vi.fn();
    render(<NotesEditor notes={notes} onSave={onSave} onRemove={vi.fn()} onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Add a routine" }));
    await userEvent.type(screen.getByLabelText("Routine"), "Physio on Tuesdays");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({ kind: "routine", text: "Physio on Tuesdays" });
    expect(onSave.mock.calls[0][0].pinned).toBeUndefined();
  });

  it("saves notes from a document", async () => {
    const onSave = vi.fn();
    const readDocument = vi.fn().mockResolvedValue({ ok: true, truncated: false, notes: [{ kind: "preference", text: "I love chess." }] });
    render(<NotesEditor notes={notes} onSave={onSave} onRemove={vi.fn()} onDone={vi.fn()} readDocument={readDocument} />);
    await userEvent.click(screen.getByRole("button", { name: "Add notes from a document" }));
    await userEvent.upload(screen.getByLabelText(/Choose a document/), new File(["x"], "me.txt"));
    await userEvent.click(await screen.findByRole("button", { name: "Save 1 note" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({ kind: "preference", text: "I love chess." });
  });
});

describe("DocumentImport", () => {
  it("shows the privacy line, then saves only the ticked notes", async () => {
    const onSave = vi.fn();
    const readDocument = vi.fn().mockResolvedValue({
      ok: true,
      truncated: true,
      notes: [
        { kind: "about-me", text: "I have ALS." },
        { kind: "person", name: "Leila", text: "Leila is my daughter." },
      ],
    });
    render(<DocumentImport onSave={onSave} onCancel={vi.fn()} readDocument={readDocument} />);
    expect(screen.getByText(/sent to the AI service/)).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText(/Choose a document/), new File(["x"], "me.txt"));
    expect(await screen.findByText("The document was long, so only the first part was used.")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("I have ALS."));
    await userEvent.click(screen.getByRole("button", { name: "Save 1 note" }));
    expect(onSave).toHaveBeenCalledWith([{ kind: "person", name: "Leila", text: "Leila is my daughter." }]);
  });

  it("shows the error and lets the user try another file", async () => {
    const readDocument = vi.fn().mockResolvedValue({ ok: false, message: "OnBeat couldn't find any text in that file." });
    render(<DocumentImport onSave={vi.fn()} onCancel={vi.fn()} readDocument={readDocument} />);
    await userEvent.upload(screen.getByLabelText(/Choose a document/), new File(["x"], "scan.pdf"));
    expect(await screen.findByText("OnBeat couldn't find any text in that file.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Choose a document/)).toBeEnabled();
  });
});
