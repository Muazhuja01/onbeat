import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/types";
import { ContextButton, ContextChips } from "./context-bar";
import { DemoChip } from "./demo-chip";
import { Notice } from "./notice-banner";
import { TopBar } from "./top-bar";

const note = (id: string, kind: Note["kind"], name: string): Note => ({ id, kind, text: name, entities: [name], updatedAt: 1 });
const places = [note("p1", "place", "Blue Door Café")];
const people = [note("s1", "person", "Sam")];

describe("TopBar", () => {
  it("shows the mark and what it is given", () => {
    render(<TopBar start={<button type="button">Listen</button>} end={<button type="button">Settings</button>} />);
    expect(screen.getByText("OnBeat")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Listen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });
});

describe("ContextChips", () => {
  it("chooses the place and the person", async () => {
    const onChange = vi.fn();
    render(<ContextChips places={places} people={people} placeId="p1" onChange={onChange} />);
    expect(screen.getByLabelText("Place")).toHaveValue("p1");
    await userEvent.selectOptions(screen.getByLabelText("Talking with"), "s1");
    expect(onChange).toHaveBeenCalledWith("p1", "s1");
  });
});

describe("ContextButton", () => {
  it("names where and who, and changes them in a sheet", async () => {
    const onChange = vi.fn();
    render(<ContextButton places={places} people={people} placeId="p1" partnerId="s1" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Where and who: Blue Door Café, Sam" }));
    const sheet = screen.getByRole("dialog", { name: "Where and who" });
    await userEvent.selectOptions(within(sheet).getByLabelText("Place"), "");
    expect(onChange).toHaveBeenCalledWith(undefined, "s1");
    await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(sheet).not.toHaveAttribute("open");
  });

  it("gives the selects in the sheet an outline that meets 3:1", async () => {
    render(<ContextButton places={places} people={people} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Where and who: No place, Someone new" }));
    expect(screen.getByLabelText("Place")).toHaveClass("border-muted");
    expect(screen.getByLabelText("Talking with")).toHaveClass("border-muted");
  });
});

describe("DemoChip", () => {
  it("names the demo, says nothing is saved and offers your own profile", async () => {
    const onSetup = vi.fn();
    render(<DemoChip name="Maya" onSetup={onSetup} />);
    expect(screen.getByText("Demo: Maya")).toBeInTheDocument();
    expect(screen.getByText("Nothing you do here is saved.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Set up your own" }));
    expect(onSetup).toHaveBeenCalled();
  });
});

describe("Notice", () => {
  it("can be dismissed when it allows it", async () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Notice text="Suggestions are paused." onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalled();
    rerender(<Notice text="Suggestions are paused." />);
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });
});
