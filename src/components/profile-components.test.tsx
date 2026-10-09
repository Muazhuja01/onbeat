import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/types";
import { DocumentImport } from "./document-import";
import { NoteForm } from "./note-form";
import { NotesEditor } from "./notes-editor";
import { ProfileMenu } from "./profile-menu";
import { DEFAULT_VOICE } from "@/lib/voice/choices";
import type { VoiceEngine } from "@/lib/voice/engine";
import { ProfileSetup } from "./profile-setup";

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

describe("ProfileSetup", () => {
  it("says on the last step that notes will be suggested", async () => {
    render(<ProfileSetup onDone={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("What's your name?"), "Priya{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("OnBeat will suggest notes from your conversations. You choose what to keep. You can turn this off in Settings.")).toBeInTheDocument();
  });

  it("walks through the steps and builds the notes", async () => {
    const onDone = vi.fn();
    render(<ProfileSetup onDone={onDone} onDemo={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("What's your name?"), "  Maya {Enter}");
    expect(screen.getByRole("heading", { name: "Tell OnBeat about you" })).toHaveFocus();
    await userEvent.type(screen.getByLabelText("About you"), "I type to talk.");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(screen.getByLabelText("Name", { selector: "#person-name" }), "Sam");
    await userEvent.type(screen.getByLabelText("Who they are to you"), "my barista");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    expect(screen.getByText("Sam: my barista")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    const [name, made] = onDone.mock.calls[0];
    expect(name).toBe("Maya");
    expect(made.map((n: Note) => n.text)).toEqual(["I'm Maya. I type to talk.", "Sam: my barista"]);
    expect(made[0].pinned).toBe(true);
  });

  it("keeps notes from a document", async () => {
    const onDone = vi.fn();
    const readDocument = vi.fn().mockResolvedValue({ ok: true, truncated: false, notes: [{ kind: "routine", text: "Physio on Tuesdays." }] });
    render(<ProfileSetup onDone={onDone} readDocument={readDocument} />);
    await userEvent.type(screen.getByLabelText("What's your name?"), "Tom{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Start from a document" }));
    await userEvent.upload(screen.getByLabelText(/Choose a document/), new File(["x"], "me.txt"));
    await userEvent.click(await screen.findByRole("button", { name: "Save 1 note" }));
    expect(screen.getByText("1 note from your document will be added.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(onDone.mock.calls[0][1].map((n: Note) => n.text)).toEqual(["I'm Tom.", "Physio on Tuesdays."]);
  });

  it("ignores a second tap on Finish while saving", async () => {
    let finish: () => void = () => {};
    const onDone = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<ProfileSetup onDone={onDone} />);
    await userEvent.type(screen.getByLabelText("What's your name?"), "Tom{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    const done = screen.getByRole("button", { name: "Finish" });
    await userEvent.click(done);
    await userEvent.click(done);
    expect(onDone).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(done).toBeEnabled();
  });

  it("goes back without losing what was typed", async () => {
    render(<ProfileSetup onDone={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("What's your name?"), "Tom");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("What's your name?")).toHaveValue("Tom");
    expect(screen.queryByRole("button", { name: "Try a demo first" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("asks for a voice as step 3 of 4 and saves it with the profile", async () => {
    const onDone = vi.fn();
    render(<ProfileSetup onDone={onDone} voiceMode="natural" voiceProgress={100} voice={null} />);
    await userEvent.type(screen.getByLabelText("What's your name?"), "Tom");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "How should your voice sound?" })).toHaveFocus();
    expect(screen.getByText("Step 3 of 4")).toBeVisible();
    await userEvent.click(screen.getByRole("radio", { name: "Male" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(onDone).toHaveBeenCalledWith("Tom", expect.any(Array), { gender: "male", accent: "american", style: "deep", speed: "normal", v: 2 });
  });

  it("keeps the default voice on Skip", async () => {
    const onDone = vi.fn();
    render(<ProfileSetup onDone={onDone} voiceMode="natural" voiceProgress={100} voice={null} />);
    await userEvent.type(screen.getByLabelText("What's your name?"), "Maya");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("radio", { name: "Male" }));
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(onDone.mock.calls[0][2]).toEqual(DEFAULT_VOICE);
  });

  it("stops a playing sample when leaving the voice step", async () => {
    const voice = { sample: vi.fn(() => new Promise<void>(() => {})), stop: vi.fn() } as unknown as VoiceEngine & { stop: ReturnType<typeof vi.fn> };
    const onCancel = vi.fn();
    render(<ProfileSetup onDone={vi.fn()} onCancel={onCancel} voiceMode="natural" voiceProgress={100} voice={voice} />);
    await userEvent.type(screen.getByLabelText("What's your name?"), "Tom");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    for (const leave of ["Back", "Skip", "Next"]) {
      await userEvent.click(screen.getByRole("button", { name: "Play a sample" }));
      voice.stop.mockClear();
      await userEvent.click(screen.getByRole("button", { name: leave }));
      expect(voice.stop).toHaveBeenCalled();
      // Back to the voice step.
      await userEvent.click(screen.getByRole("button", { name: leave === "Back" ? "Next" : "Back" }));
    }
    await userEvent.click(screen.getByRole("button", { name: "Play a sample" }));
    voice.stop.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(voice.stop).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("ProfileMenu", () => {
  const profiles = [
    { id: "a", name: "Maya", createdAt: 1 },
    { id: "b", name: "Tom", createdAt: 2 },
  ];
  const handlers = () => ({
    onSwitch: vi.fn(),
    onNotes: vi.fn(),
    onNew: vi.fn(),
    onExport: vi.fn(),
    onImport: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onDemo: vi.fn(),
  });

  it("shows how many suggested notes wait, and opens them", async () => {
    const h = handlers();
    const onSuggestions = vi.fn();
    render(<ProfileMenu profiles={profiles} activeId="a" demoName={null} suggestionCount={3} onSuggestions={onSuggestions} {...h} />);
    const toggle = screen.getByRole("button", { name: "Maya, 3 suggested notes" });
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: "Suggested notes (3)" }));
    expect(onSuggestions).toHaveBeenCalled();
  });

  it("offers Settings when asked, as on phones", async () => {
    const onSettings = vi.fn();
    render(<ProfileMenu profiles={profiles} activeId="a" demoName={null} {...handlers()} compact onSettings={onSettings} />);
    await userEvent.click(screen.getByRole("button", { name: "Maya" }));
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onSettings).toHaveBeenCalled();
  });

  it("opens as a sheet from the bottom on phones, and closes on Escape", async () => {
    render(<ProfileMenu profiles={profiles} activeId="a" demoName={null} {...handlers()} compact onSettings={vi.fn()} />);
    const toggle = screen.getByRole("button", { name: "Maya" });
    await userEvent.click(toggle);
    const sheet = screen.getByRole("dialog", { name: "Maya" });
    expect(sheet).toHaveClass("sheet-bottom");
    expect(within(sheet).getByRole("button", { name: "Your notes" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Your notes" })).toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });

  it("names the button plainly with nothing to review", async () => {
    render(<ProfileMenu profiles={profiles} activeId="a" demoName={null} suggestionCount={0} onSuggestions={vi.fn()} {...handlers()} />);
    await userEvent.click(screen.getByRole("button", { name: "Maya" }));
    expect(screen.getByRole("button", { name: "Suggested notes" })).toBeInTheDocument();
  });

  it("switches profile and closes", async () => {
    const h = handlers();
    render(<ProfileMenu profiles={profiles} activeId="a" demoName={null} {...h} />);
    const toggle = screen.getByRole("button", { name: "Maya" });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("button", { name: "Switch to Tom" }));
    expect(h.onSwitch).toHaveBeenCalledWith("b");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("renames", async () => {
    const h = handlers();
    render(<ProfileMenu profiles={profiles} activeId="a" demoName={null} {...h} />);
    await userEvent.click(screen.getByRole("button", { name: "Maya" }));
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    const field = screen.getByLabelText("Profile name");
    await userEvent.clear(field);
    await userEvent.type(field, "Maya L{Enter}");
    expect(h.onRename).toHaveBeenCalledWith("Maya L");
  });

  it("confirms before deleting", async () => {
    const h = handlers();
    render(<ProfileMenu profiles={profiles} activeId="a" demoName={null} {...h} />);
    await userEvent.click(screen.getByRole("button", { name: "Maya" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete this profile" }));
    expect(screen.getByText(/Export first/)).toBeInTheDocument();
    expect(h.onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete Maya" }));
    expect(h.onDelete).toHaveBeenCalled();
  });

  it("closes on Escape and returns focus", async () => {
    render(<ProfileMenu profiles={profiles} activeId="a" demoName={null} {...handlers()} />);
    const toggle = screen.getByRole("button", { name: "Maya" });
    await userEvent.click(toggle);
    await userEvent.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });

  it("imports a file", async () => {
    const h = handlers();
    render(<ProfileMenu profiles={profiles} activeId="a" demoName={null} {...h} />);
    await userEvent.click(screen.getByRole("button", { name: "Maya" }));
    const file = new File(["{}"], "onbeat-maya.json", { type: "application/json" });
    await userEvent.upload(screen.getByLabelText("Import a profile"), file);
    expect(h.onImport).toHaveBeenCalledWith(file);
  });

  it("offers setup and saved profiles in a demo", async () => {
    const h = handlers();
    render(<ProfileMenu profiles={profiles} activeId="a" demoName="Aisha" {...h} />);
    await userEvent.click(screen.getByRole("button", { name: "Demo: Aisha" }));
    expect(screen.getByRole("button", { name: "Switch to Maya" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Your notes" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Set up your own profile" }));
    expect(h.onNew).toHaveBeenCalled();
  });

  it("shows the voice and opens the voice screen", async () => {
    const h = handlers();
    const onVoice = vi.fn();
    render(<ProfileMenu profiles={profiles} activeId="a" demoName={null} voiceLabel="Male, American, calm" onVoice={onVoice} {...h} />);
    await userEvent.click(screen.getByRole("button", { name: "Maya" }));
    await userEvent.click(screen.getByRole("button", { name: "Voice: Male, American, calm" }));
    expect(onVoice).toHaveBeenCalled();
  });

  it("has no voice item in a demo", async () => {
    render(<ProfileMenu profiles={profiles} activeId="a" demoName="Aisha" voiceLabel="Male, American, calm" onVoice={vi.fn()} {...handlers()} />);
    await userEvent.click(screen.getByRole("button", { name: "Demo: Aisha" }));
    expect(screen.queryByRole("button", { name: /^Voice:/ })).toBeNull();
  });

  it("offers the assistant only when given a handler", async () => {
    const h = handlers();
    const onAssistant = vi.fn();
    const { unmount } = render(<ProfileMenu profiles={profiles} activeId="a" demoName={null} {...h} />);
    await userEvent.click(screen.getByRole("button", { name: "Maya" }));
    expect(screen.queryByRole("button", { name: "Assistant" })).toBeNull();
    unmount();
    render(<ProfileMenu profiles={profiles} activeId="a" demoName={null} {...h} onAssistant={onAssistant} />);
    await userEvent.click(screen.getByRole("button", { name: "Maya" }));
    await userEvent.click(screen.getByRole("button", { name: "Assistant" }));
    expect(onAssistant).toHaveBeenCalled();
  });
});
