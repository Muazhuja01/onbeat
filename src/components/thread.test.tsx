import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Turn } from "@/lib/types";
import { Thread } from "./thread";

const turns: Turn[] = [
  { id: "1", speaker: "partner", text: "What size?", at: 1 },
  { id: "2", speaker: "user", text: "Large, please.", at: 2 },
];

/** Gives the list a scroll position jsdom can't compute. */
function fakeScroll(list: HTMLElement) {
  let top = 0;
  Object.defineProperty(list, "scrollHeight", { configurable: true, get: () => 1000 });
  Object.defineProperty(list, "clientHeight", { configurable: true, get: () => 200 });
  Object.defineProperty(list, "scrollTop", { configurable: true, get: () => top, set: (v: number) => (top = v) });
  return { get: () => top, set: (v: number) => (top = v) };
}

describe("Thread", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("labels who said each line: their name on the left, You in a bubble", () => {
    render(<Thread turns={turns} partnerName="Sam" />);
    const items = within(screen.getByRole("region", { name: "Conversation" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["SamWhat size?", "YouLarge, please."]);
  });

  it("shows a live line while they are still talking", () => {
    render(<Thread turns={[]} partnerName="Sam" partial="What size" />);
    expect(screen.getByRole("listitem")).toHaveTextContent("Sam (still talking)What size…");
    expect(screen.queryByText("Ready when you are")).toBeNull();
  });

  it("says what to do before anyone talks", () => {
    render(<Thread turns={[]} partnerName="Sam" />);
    expect(screen.getByText("Ready when you are")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("marks the line being spoken, with a Stop button, and the wait for your voice", async () => {
    const onStop = vi.fn();
    const said: Turn[] = [...turns, { id: "3", speaker: "user", text: "Thanks.", at: 3 }];
    const { rerender } = render(<Thread turns={said} partnerName="Sam" speaking="Thanks." waiting onStop={onStop} />);
    const items = screen.getAllByRole("listitem");
    expect(items[1]).toHaveTextContent(/^You/);
    expect(within(items[2]).getByText("Getting your voice ready…")).toBeInTheDocument();
    rerender(<Thread turns={said} partnerName="Sam" speaking="Thanks." onStop={onStop} />);
    expect(within(items[2]).getByText("Speaking")).toBeInTheDocument();
    await userEvent.click(within(items[2]).getByRole("button", { name: "Stop speaking" }));
    expect(onStop).toHaveBeenCalled();
  });

  it("shows a note under the line it is about", () => {
    render(<Thread turns={turns} partnerName="Sam" lineNotes={{ "2": "Said in your device's voice: yours wasn't ready in time." }} />);
    expect(screen.getAllByRole("listitem")[1]).toHaveTextContent("Said in your device's voice: yours wasn't ready in time.");
  });

  it("follows new lines until you scroll back, then offers Newest instead of jumping", async () => {
    const { rerender } = render(<Thread turns={turns} partnerName="Sam" partial="What" />);
    const list = screen.getByRole("list", { name: "Conversation lines" });
    const top = fakeScroll(list);

    rerender(<Thread turns={turns} partnerName="Sam" partial="What size" />);
    expect(top.get()).toBe(1000);
    expect(screen.queryByRole("button", { name: "Newest" })).toBeNull();

    // You scroll back to reread, then say something: the thread stays where you are.
    top.set(300);
    act(() => list.dispatchEvent(new Event("scroll")));
    const more: Turn[] = [...turns, { id: "3", speaker: "user", text: "Thanks.", at: 3 }];
    rerender(<Thread turns={more} partnerName="Sam" partial="What size" />);
    expect(top.get()).toBe(300);

    await userEvent.click(screen.getByRole("button", { name: "Newest" }));
    expect(top.get()).toBe(1000);
    expect(screen.queryByRole("button", { name: "Newest" })).toBeNull();
  });

  it("asks before clearing the conversation", async () => {
    const onNew = vi.fn();
    render(<Thread turns={turns} partnerName="Sam" onNewConversation={onNew} />);
    await userEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(screen.getByText("Clear this conversation? It isn't saved anywhere.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onNew).toHaveBeenCalled();
  });

  it("lets a long unbroken word wrap on both sides", () => {
    const word = "o".repeat(200);
    const long: Turn[] = [
      { id: "1", speaker: "partner", text: word, at: 1 },
      { id: "2", speaker: "user", text: word, at: 2 },
    ];
    render(<Thread turns={long} partnerName="Sam" />);
    const items = screen.getAllByRole("listitem");
    for (const li of items) {
      expect(within(li).getByText(word)).toHaveClass("[overflow-wrap:anywhere]");
    }
    expect(items[1].firstElementChild).toHaveClass("min-w-0", "max-w-full");
  });

  describe("when the thread is resized", () => {
    function installObserver() {
      let callback: () => void = () => {};
      const disconnect = vi.fn();
      class FakeResizeObserver {
        constructor(cb: () => void) {
          callback = cb;
        }
        observe() {}
        unobserve() {}
        disconnect = disconnect;
      }
      vi.stubGlobal("ResizeObserver", FakeResizeObserver);
      return { fire: () => act(() => callback()), disconnect };
    }

    it("keeps the newest line in view while following", () => {
      const observer = installObserver();
      render(<Thread turns={turns} partnerName="Sam" />);
      const top = fakeScroll(screen.getByRole("list", { name: "Conversation lines" }));
      observer.fire();
      expect(top.get()).toBe(1000);
    });

    it("leaves the thread alone once you have scrolled up", () => {
      const observer = installObserver();
      render(<Thread turns={turns} partnerName="Sam" />);
      const list = screen.getByRole("list", { name: "Conversation lines" });
      const top = fakeScroll(list);
      top.set(300);
      act(() => list.dispatchEvent(new Event("scroll")));
      observer.fire();
      expect(top.get()).toBe(300);
    });

    it("stops watching when it unmounts", () => {
      const observer = installObserver();
      const { unmount } = render(<Thread turns={turns} partnerName="Sam" />);
      unmount();
      expect(observer.disconnect).toHaveBeenCalled();
    });
  });
});
