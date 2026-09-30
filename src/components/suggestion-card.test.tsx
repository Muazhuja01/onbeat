import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SuggestionCard } from "./suggestion-card";

const handlers = () => ({ onKeep: vi.fn(), onEdit: vi.fn(), onSkip: vi.fn() });

describe("SuggestionCard", () => {
  it("shows old and new text for a change, with the three buttons", async () => {
    const h = handlers();
    render(
      <ul>
        <SuggestionCard heading="Change a note: Routines" current="Physio on Tuesdays." text="Physio on Thursdays." sources={<p>You said: moved</p>} editing={false} {...h} />
      </ul>,
    );
    expect(screen.getByRole("heading", { name: "Change a note: Routines" })).toBeVisible();
    expect(screen.getByText("Physio on Tuesdays.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Keep: Physio on Thursdays." }));
    expect(h.onKeep).toHaveBeenCalled();
  });

  it("offers only what is allowed, with a notice", () => {
    render(
      <ul>
        <SuggestionCard heading="Remove a note: Places" text="Home is on Cedar Street." sources={null} editing={false} keepLabel="Delete" canEdit={false} notice="This note has changed since." canKeep={false} {...handlers()} />
      </ul>,
    );
    expect(screen.getByText("This note has changed since.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Skip: Home is on Cedar Street." })).toBeVisible();
  });
});
