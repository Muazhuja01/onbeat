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

  it("keeps their latest line in view when your reply after it would push it off the top", () => {
    const { rerender } = render(<Thread turns={turns.slice(0, 1)} partnerName="Sam" />);
    const list = screen.getByRole("list", { name: "Conversation lines" });
    const top = fakeScroll(list);
    // Their line starts 500 px down the thread; the thread shows 200 px at a time.
    list.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    const theirs = () => screen.getAllByRole("listitem")[0];
    theirs().getBoundingClientRect = () => ({ top: 100 + 500 - top.get() }) as DOMRect;

    rerender(<Thread turns={turns} partnerName="Sam" />);
    // Scrolled to the top of their line, not to the end where only your bubble would show.
    expect(top.get()).toBeLessThanOrEqual(500);
    expect(top.get()).toBeGreaterThan(450);
    // Your line is below, so Newest is offered to reach it.
    act(() => list.dispatchEvent(new Event("scroll")));
    expect(screen.getByRole("button", { name: "Newest" })).toBeInTheDocument();

    // It still counts as following: when they speak again, their new line is the newest, so follow to the end.
    rerender(<Thread turns={[...turns, { id: "3", speaker: "partner", text: "Hot or iced?", at: 3 }]} partnerName="Sam" />);
    expect(top.get()).toBe(1000);
  });

  it("follows to the end once you say more than one line after theirs", () => {
    const { rerender } = render(<Thread turns={turns} partnerName="Sam" />);
    const list = screen.getByRole("list", { name: "Conversation lines" });
    const top = fakeScroll(list);
    list.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    screen.getAllByRole("listitem")[0].getBoundingClientRect = () => ({ top: 100 + 500 - top.get() }) as DOMRect;

    rerender(<Thread turns={[...turns, { id: "3", speaker: "user", text: "And a muffin.", at: 3 }]} partnerName="Sam" />);
    expect(top.get()).toBe(1000);
  });

  it("follows when a note or the Stop row makes your last line taller", () => {
    const said: Turn[] = [...turns, { id: "3", speaker: "user", text: "Thanks.", at: 3 }];
    const { rerender } = render(<Thread turns={said} partnerName="Sam" onStop={() => {}} />);
    const top = fakeScroll(screen.getByRole("list", { name: "Conversation lines" }));

    rerender(<Thread turns={said} partnerName="Sam" onStop={() => {}} speaking="Thanks." />);
    expect(top.get()).toBe(1000);

    top.set(0);
    rerender(<Thread turns={said} partnerName="Sam" onStop={() => {}} lineNotes={{ "3": "Said in the backup voice." }} />);
    expect(top.get()).toBe(1000);
  });

  it("follows again in the next conversation after clearing while scrolled back", () => {
    const { rerender } = render(<Thread turns={turns} partnerName="Sam" />);
    const list = screen.getByRole("list", { name: "Conversation lines" });
    const top = fakeScroll(list);
    top.set(300);
    act(() => list.dispatchEvent(new Event("scroll")));
    expect(screen.getByRole("button", { name: "Newest" })).toBeInTheDocument();

    rerender(<Thread turns={[]} partnerName="Sam" />);
    rerender(<Thread turns={turns.slice(0, 1)} partnerName="Sam" />);
    expect(screen.queryByRole("button", { name: "Newest" })).toBeNull();
    const next = fakeScroll(screen.getByRole("list", { name: "Conversation lines" }));
    rerender(<Thread turns={[...turns.slice(0, 1), { id: "4", speaker: "partner", text: "Hot or iced?", at: 4 }]} partnerName="Sam" />);
    expect(next.get()).toBe(1000);
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
      // Their line is the newest, so following goes to the end.
      render(<Thread turns={[...turns, { id: "3", speaker: "partner", text: "Hot or iced?", at: 3 }]} partnerName="Sam" />);
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
