import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuickPhrasesEditor } from "./quick-phrases-editor";

const sam = { id: "sam", kind: "person" as const, text: "Sam is the barista.", entities: ["Sam"], updatedAt: 0 };
const phrase = { id: "p1", text: "My usual, please.", context: { partnerId: "sam", timeOfDay: "morning" as const }, timesUsed: 0, lastUsed: 0, quick: true as const };

function show(overrides = {}) {
  const props = { phrases: [phrase], people: [sam], places: [], onAdd: vi.fn(async () => true), onUpdate: vi.fn(async () => true), onRemove: vi.fn(), ...overrides };
  render(<QuickPhrasesEditor {...props} />);
  return props;
}

describe("QuickPhrasesEditor", () => {
  it("lists phrases with who they are for", () => {
    show();
    expect(screen.getByText("My usual, please.")).toBeVisible();
    expect(screen.getByText("For: Sam")).toBeVisible();
  });

  it("adds a phrase for a person", async () => {
    const p = show();
    await userEvent.click(screen.getByRole("button", { name: "Add a phrase" }));
    await userEvent.type(screen.getByLabelText("Phrase"), "Thanks, Sam.");
    await userEvent.selectOptions(screen.getByLabelText("For"), "person:sam");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(p.onAdd).toHaveBeenCalledWith("Thanks, Sam.", { partnerId: "sam" });
  });

  it("says when the phrase is already there", async () => {
    show({ onAdd: vi.fn(async () => false) });
    await userEvent.click(screen.getByRole("button", { name: "Add a phrase" }));
    await userEvent.type(screen.getByLabelText("Phrase"), "My usual, please.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("You already have this phrase.")).toBeVisible();
  });

  it("asks before deleting", async () => {
    const p = show();
    await userEvent.click(screen.getByRole("button", { name: "Delete: My usual, please." }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(p.onRemove).toHaveBeenCalledWith("p1");
  });
});
