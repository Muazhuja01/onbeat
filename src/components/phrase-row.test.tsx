import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PhraseRow } from "./phrase-row";

const phrase = (text: string) => ({ id: text, text, context: { timeOfDay: "morning" as const }, timesUsed: 0, lastUsed: 0, quick: true as const });

describe("PhraseRow", () => {
  it("speaks a phrase with one tap", async () => {
    const onSpeak = vi.fn();
    render(<PhraseRow phrases={[phrase("My usual, please.")]} onSpeak={onSpeak} />);
    expect(screen.getByRole("group", { name: "Your phrases" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "My usual, please." }));
    expect(onSpeak).toHaveBeenCalledWith("My usual, please.");
  });

  it("is hidden with no phrases", () => {
    const { container } = render(<PhraseRow phrases={[]} onSpeak={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
