import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TheySaidButton, TheySaidForm } from "./they-said";

function Harness({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  return open ? <TheySaidForm onSubmit={onSubmit} onClose={() => setOpen(false)} /> : <TheySaidButton onOpen={() => setOpen(true)} />;
}

/** Like the conversation screen: closing the box puts focus back in "Type a reply". */
function WithReplyBox() {
  const [open, setOpen] = useState(false);
  const reply = useRef<HTMLInputElement>(null);
  return (
    <>
      {open ? (
        <TheySaidForm
          onSubmit={vi.fn()}
          onClose={() => {
            setOpen(false);
            reply.current?.focus();
          }}
        />
      ) : (
        <TheySaidButton onOpen={() => setOpen(true)} />
      )}
      <label>
        Type a reply
        <input ref={reply} />
      </label>
    </>
  );
}

describe("They said", () => {
  it("opens a box for their words, adds the line on Enter and closes", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "They said" }));
    const box = screen.getByLabelText("What they said");
    expect(box).toHaveFocus();
    await userEvent.type(box, "Hot or iced?{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("Hot or iced?");
    expect(screen.queryByLabelText("What they said")).toBeNull();
    expect(screen.getByRole("button", { name: "They said" })).toBeInTheDocument();
  });

  it("does nothing with an empty box, and closes on Cancel", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "They said" }));
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("What they said")).toBeNull();
  });

  it("closes on Escape without the page's own Escape running", async () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    render(<Harness onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "They said" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByLabelText("What they said")).toBeNull();
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKey);
  });

  it.each([
    ["Add", async () => userEvent.type(screen.getByLabelText("What they said"), "Hi{Enter}")],
    ["Escape", async () => userEvent.keyboard("{Escape}")],
    ["Cancel", async () => userEvent.click(screen.getByRole("button", { name: "Cancel" }))],
  ])("gives focus back to Type a reply after %s", async (_, close) => {
    render(<WithReplyBox />);
    await userEvent.click(screen.getByRole("button", { name: "They said" }));
    await close();
    expect(screen.queryByLabelText("What they said")).toBeNull();
    expect(screen.getByLabelText("Type a reply")).toHaveFocus();
  });

  it("gives the box an outline that meets 3:1, not the faint edge", async () => {
    render(<Harness onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "They said" }));
    expect(screen.getByLabelText("What they said")).toHaveClass("border-muted");
  });
});
