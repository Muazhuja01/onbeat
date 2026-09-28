import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as browserMemory from "@/lib/memory/browser";
import { MemoryStore } from "@/lib/memory/store";
import type { SuggestInput, SuggestUpdate } from "@/lib/suggest/client";
import type { Reply } from "@/lib/types";

const h = vi.hoisted(() => {
  type Listener = (v: unknown) => void;
  const listeners: Record<string, Set<Listener>> = { start: new Set(), end: new Set(), mode: new Set(), progress: new Set() };
  const voice = {
    mode: "basic" as const,
    on(event: string, cb: Listener) {
      listeners[event].add(cb);
      return () => listeners[event].delete(cb);
    },
    load: () => {},
    prepare: () => {},
    speak: async (text: string) => {
      for (const cb of listeners.start) cb(text);
    },
    stop: () => {},
  };
  const emit = (event: string, v: unknown) => {
    for (const cb of listeners[event]) cb(v);
  };
  const requests: { input: SuggestInput; onUpdate: (u: SuggestUpdate) => void }[] = [];
  const hearingListeners: Record<string, Set<Listener>> = {
    status: new Set(),
    progress: new Set(),
    level: new Set(),
    speechStart: new Set(),
    partial: new Set(),
    turnEnd: new Set(),
  };
  const hearing = {
    status: "off",
    on(event: string, cb: Listener) {
      hearingListeners[event].add(cb);
      return () => hearingListeners[event].delete(cb);
    },
    start: async () => {},
    stop: () => {},
    pause: () => {},
    resume: () => {},
  };
  const hear = (event: string, v: unknown) => {
    for (const cb of hearingListeners[event]) cb(v);
  };
  return { voice, emit, requests, hearing, hear };
});

vi.mock("@/lib/voice/browser", () => ({ getBrowserVoice: () => h.voice }));
vi.mock("@/lib/hearing/browser", () => ({ getBrowserHearing: () => h.hearing }));

vi.mock("@/lib/memory/browser", async () => {
  const { MemoryStore } = await import("@/lib/memory/store");
  return { getBrowserMemory: () => MemoryStore.create() };
});

vi.mock("@/lib/suggest/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/suggest/client")>();
  class FakeSuggestClient {
    // Mirrors the real client's generation counter: cancel() bumps it, so an
    // update for a request issued before the cancel is dropped when it
    // finally answers instead of applying to whatever is on screen now.
    private generation = 0;
    cancel() {
      this.generation++;
    }
    clearCache() {}
    async request(input: SuggestInput, onUpdate: (u: SuggestUpdate) => void) {
      const generation = this.generation;
      const guardedUpdate = (u: SuggestUpdate) => {
        if (generation === this.generation) onUpdate(u);
      };
      h.requests.push({ input, onUpdate: guardedUpdate });
      return null;
    }
  }
  return { ...actual, SuggestClient: FakeSuggestClient };
});

import { ConversationScreen } from "./conversation-screen";

const reply = (text: string): Reply => ({ text, noteIds: [], source: "model" });

/** Answer the latest suggestion request. */
function answer(...texts: string[]) {
  act(() => h.requests.at(-1)!.onUpdate({ replies: texts.map(reply), reactions: [], done: true }));
}

/** Answer the latest suggestion request with a reaction on offer. */
function answerWithReaction(text: string) {
  act(() => h.requests.at(-1)!.onUpdate({ replies: [], reactions: [{ id: "r1", text }], done: true }));
}

async function partnerSays(text: string) {
  await userEvent.type(screen.getByLabelText("What they said"), text);
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
}

async function startWithMaya() {
  render(<ConversationScreen />);
  await userEvent.click(await screen.findByRole("button", { name: /^Maya/ }));
  await screen.findByRole("heading", { name: "Replies" });
}

const liveRegion = () => document.querySelector<HTMLElement>('[aria-live="polite"]')!;

beforeEach(() => {
  h.requests.length = 0;
  h.voice.stop = vi.fn();
  h.hearing.start = vi.fn(async () => {});
  h.hearing.stop = vi.fn();
  h.hearing.pause = vi.fn();
  h.hearing.resume = vi.fn();
});

describe("ConversationScreen", () => {
  it("resets focus to the top of the page after choosing a profile", async () => {
    await startWithMaya();
    // The picker's own (now removed) button must not leave the browser's next
    // Tab landing somewhere in the middle of the page.
    expect(document.activeElement).toBe(document.body);
    expect(document.body).not.toHaveAttribute("tabindex");
  });

  it("holds new replies while the pointer is over the list after choosing a profile", async () => {
    await startWithMaya();
    await partnerSays("What size?");
    answer("Large, please.");
    expect(screen.getByRole("button", { name: "Large, please." })).toBeInTheDocument();

    const list = document.getElementById("replies")!;
    fireEvent.pointerEnter(list);
    fireEvent.pointerMove(list);
    await partnerSays("Anything else?");
    answer("No, thank you.");
    expect(screen.getByRole("button", { name: "Large, please." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "No, thank you." })).not.toBeInTheDocument();

    fireEvent.pointerLeave(list);
    expect(screen.getByRole("button", { name: "No, thank you." })).toBeInTheDocument();
  });

  it("cancels an in-flight request when switching profiles, so the old profile's late reply never appears", async () => {
    await startWithMaya();
    await partnerSays("What size?");
    expect(h.requests).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Example profiles" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Tom/ }));
    await screen.findByRole("heading", { name: "Replies" });

    // The late result for Maya's request must never reach the screen now
    // that Tom is the active profile.
    answer("Large, please.");
    expect(screen.queryByRole("button", { name: "Large, please." })).not.toBeInTheDocument();
  });

  it("announces new caption lines and each new set of replies", async () => {
    await startWithMaya();
    await partnerSays("What size?");
    await waitFor(() => expect(liveRegion()).toHaveTextContent("Sam said: What size?"));
    answer("Large, please.");
    await waitFor(() => expect(liveRegion()).toHaveTextContent("1 reply ready"), { timeout: 2000 });
    answer("Large, please.", "Medium, please.");
    await waitFor(() => expect(liveRegion()).toHaveTextContent("2 replies ready"), { timeout: 2000 });
  });

  it("stops speech with Escape, and only clears the reply box when focus is in it or outside text fields", async () => {
    await startWithMaya();
    const composer = screen.getByLabelText("Type a reply");
    await userEvent.type(composer, "hello");

    act(() => screen.getByLabelText("What they said").focus());
    await userEvent.keyboard("{Escape}");
    expect(composer).toHaveValue("hello");

    act(() => screen.getByLabelText("Place").focus());
    await userEvent.keyboard("{Escape}");
    expect(composer).toHaveValue("hello");

    await partnerSays("What size?");
    answer("Large, please.");
    await userEvent.click(screen.getByRole("button", { name: "Large, please." }));
    act(() => composer.focus());
    await userEvent.keyboard("{Escape}");
    expect(h.voice.stop).toHaveBeenCalledTimes(1);
    expect(composer).toHaveValue("hello");

    act(() => h.emit("end", "Large, please."));
    await userEvent.keyboard("{Escape}");
    expect(composer).toHaveValue("");
    expect(h.voice.stop).toHaveBeenCalledTimes(1);

    await userEvent.type(composer, "hi");
    act(() => composer.blur());
    await userEvent.keyboard("{Escape}");
    expect(composer).toHaveValue("");
  });

  it("stops speech when the example profiles are opened while speaking", async () => {
    await startWithMaya();
    await partnerSays("What size?");
    answer("Large, please.");
    await userEvent.click(screen.getByRole("button", { name: "Large, please." }));
    expect(screen.getByRole("button", { name: "Stop saying: Large, please." })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Example profiles" }));
    expect(h.voice.stop).toHaveBeenCalledTimes(1);
  });

  it("falls back to a session-only memory store when loading memory fails, instead of staying blank", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(browserMemory, "getBrowserMemory").mockRejectedValueOnce(new Error("indexeddb boom"));

    render(<ConversationScreen />);

    // The page recovers with a working (session-only) memory store instead
    // of staying blank forever.
    await screen.findByRole("heading", { name: "Try it with an example profile" });
    await screen.findByText("Notes won't be saved in this window.");
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("does not save a reaction as a phrase, but does save a spoken reply and clears the suggestion cache", async () => {
    const { SuggestClient } = await import("@/lib/suggest/client");
    const addPhrase = vi.spyOn(MemoryStore.prototype, "addPhrase");
    const clearCache = vi.spyOn(SuggestClient.prototype, "clearCache");

    await startWithMaya();
    // Choosing the profile itself clears the cache; that's not what this test covers.
    clearCache.mockClear();
    await partnerSays("What size?");
    answerWithReaction("Thanks!");
    await userEvent.click(screen.getByRole("button", { name: "Thanks!" }));
    expect(addPhrase).not.toHaveBeenCalled();
    expect(clearCache).not.toHaveBeenCalled();

    answer("Large, please.");
    await userEvent.click(screen.getByRole("button", { name: "Large, please." }));
    await waitFor(() => expect(addPhrase).toHaveBeenCalledWith("Large, please.", expect.anything()));
    await waitFor(() => expect(clearCache).toHaveBeenCalled());

    addPhrase.mockRestore();
    clearCache.mockRestore();
  });

  it("closes the example profiles on first run with the header button", async () => {
    render(<ConversationScreen />);
    await screen.findByRole("heading", { name: "Try it with an example profile" });
    await userEvent.click(screen.getByRole("button", { name: "Example profiles" }));
    expect(screen.queryByRole("heading", { name: "Try it with an example profile" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Replies" })).toBeInTheDocument();
  });
});

describe("ConversationScreen listening", () => {
  it("starts listening from the Listen button", async () => {
    await startWithMaya();
    await userEvent.click(screen.getByRole("button", { name: "Listen" }));
    expect(h.hearing.start).toHaveBeenCalled();
  });

  it("shows the partner's words live, then as a line that brings replies", async () => {
    await startWithMaya();
    act(() => h.hear("partial", "What size would"));
    expect(screen.getByText("What size would…")).toBeInTheDocument();
    expect(screen.getByText("(still talking)")).toBeInTheDocument();
    act(() => h.hear("turnEnd", { text: "What size would you like?", endedAt: Date.now() }));
    expect(screen.queryByText("(still talking)")).not.toBeInTheDocument();
    expect(screen.getByText("What size would you like?")).toBeInTheDocument();
    expect(h.requests.at(-1)?.input).toMatchObject({ partnerSaid: "What size would you like?", priority: "final" });
  });

  it("pauses listening while a reply is spoken", async () => {
    await startWithMaya();
    await partnerSays("What size?");
    answer("Large, please.");
    await userEvent.click(screen.getByRole("button", { name: "Large, please." }));
    expect(h.hearing.pause).toHaveBeenCalled();
    act(() => h.emit("end", "Large, please."));
    expect(h.hearing.resume).toHaveBeenCalledWith(400);
  });
});
