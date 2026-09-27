import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReplyShortcuts } from "./use-shortcuts";

function Harness(props: Parameters<typeof useReplyShortcuts>[0]) {
  useReplyShortcuts(props);
  return <input aria-label="Type a reply" />;
}

describe("useReplyShortcuts", () => {
  const setup = () => {
    const handlers = { onReply: vi.fn(), onReaction: vi.fn(), onEscape: vi.fn() };
    const utils = render(<Harness replyCount={3} reactionCount={2} {...handlers} />);
    return { ...handlers, ...utils };
  };

  it("maps 1 to 3 to replies outside text fields", () => {
    const { onReply } = setup();
    fireEvent.keyDown(document.body, { key: "2" });
    expect(onReply).toHaveBeenCalledWith(1);
    fireEvent.keyDown(document.body, { key: "4" });
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it("ignores digits typed into a text field", () => {
    const { onReply, getByLabelText } = setup();
    fireEvent.keyDown(getByLabelText("Type a reply"), { key: "1" });
    expect(onReply).not.toHaveBeenCalled();
  });

  it("maps Alt+1 and Alt+2 to reactions", () => {
    const { onReaction } = setup();
    fireEvent.keyDown(document.body, { key: "1", code: "Digit1", altKey: true });
    expect(onReaction).toHaveBeenCalledWith(0);
  });

  it("ignores a repeated key event from holding a digit down", () => {
    const { onReply } = setup();
    fireEvent.keyDown(document.body, { key: "1", repeat: true });
    expect(onReply).not.toHaveBeenCalled();
  });

  it("ignores Shift+digit", () => {
    const { onReply } = setup();
    fireEvent.keyDown(document.body, { key: "1", shiftKey: true });
    expect(onReply).not.toHaveBeenCalled();
  });

  it("lets Alt+1 trigger a reaction even while a text field has focus", () => {
    const { onReaction, getByLabelText } = setup();
    fireEvent.keyDown(getByLabelText("Type a reply"), { key: "1", code: "Digit1", altKey: true });
    expect(onReaction).toHaveBeenCalledWith(0);
  });

  it("calls onEscape anywhere", () => {
    const { onEscape, getByLabelText } = setup();
    fireEvent.keyDown(getByLabelText("Type a reply"), { key: "Escape" });
    expect(onEscape).toHaveBeenCalled();
  });

  it("keeps Escape working when disabled, but ignores digits and Alt shortcuts", () => {
    const handlers = { onReply: vi.fn(), onReaction: vi.fn(), onEscape: vi.fn() };
    render(<Harness replyCount={3} reactionCount={2} enabled={false} {...handlers} />);
    fireEvent.keyDown(document.body, { key: "1", code: "Digit1" });
    fireEvent.keyDown(document.body, { key: "1", code: "Digit1", altKey: true });
    expect(handlers.onReply).not.toHaveBeenCalled();
    expect(handlers.onReaction).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(handlers.onEscape).toHaveBeenCalledTimes(1);
  });
});
