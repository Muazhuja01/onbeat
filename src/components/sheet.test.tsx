import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "./sheet";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Where and who" closeLabel="Close">
        <p>Inside</p>
      </Sheet>
    </>
  );
}

describe("Sheet", () => {
  it("shows its content only while open, and gives focus back when closed", async () => {
    render(<Harness />);
    expect(screen.queryByText("Inside")).toBeNull();
    const opener = screen.getByRole("button", { name: "Open" });
    await userEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Where and who" });
    expect(dialog).toHaveAttribute("open");
    expect(within(dialog).getByText("Inside")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(dialog).not.toHaveAttribute("open");
    expect(screen.queryByText("Inside")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("closes on Escape without the page's own Escape running", async () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog", { name: "Where and who" });
    await userEvent.keyboard("{Escape}");
    expect(dialog).not.toHaveAttribute("open");
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKey);
  });

  it("closes when the backdrop is clicked", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog", { name: "Where and who" });
    dialog.getBoundingClientRect = () => new DOMRect(100, 100, 300, 300);
    fireEvent.click(dialog, { clientX: 5, clientY: 5 });
    expect(dialog).not.toHaveAttribute("open");
  });

  it("stays open when empty space inside the sheet is clicked", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog", { name: "Where and who" });
    dialog.getBoundingClientRect = () => new DOMRect(100, 100, 300, 300);
    fireEvent.click(dialog, { clientX: 150, clientY: 150 });
    expect(dialog).toHaveAttribute("open");
  });

  it("has a grab handle on a bottom sheet but not on a side panel", () => {
    const { rerender } = render(
      <Sheet open onClose={() => {}} title="T" closeLabel="Close">
        <p>Inside</p>
      </Sheet>,
    );
    expect(document.querySelector("[data-handle]")).not.toBeNull();
    rerender(
      <Sheet open onClose={() => {}} title="T" side="right" closeLabel="Close">
        <p>Inside</p>
      </Sheet>,
    );
    expect(document.querySelector("[data-handle]")).toBeNull();
  });
});
