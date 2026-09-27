import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  return { voice, emit, requests };
});

vi.mock("@/lib/voice/browser", () => ({ getBrowserVoice: () => h.voice }));

vi.mock("@/lib/memory/browser", async () => {
  const { MemoryStore } = await import("@/lib/memory/store");
  return { getBrowserMemory: () => MemoryStore.create() };
});

vi.mock("@/lib/suggest/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/suggest/client")>();
  class FakeSuggestClient {
    cancel() {}
    clearCache() {}
    async request(input: SuggestInput, onUpdate: (u: SuggestUpdate) => void) {
      h.requests.push({ input, onUpdate });
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
});

describe("ConversationScreen", () => {
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

  it("closes the example profiles on first run with the header button", async () => {
    render(<ConversationScreen />);
    await screen.findByRole("heading", { name: "Try it with an example profile" });
    await userEvent.click(screen.getByRole("button", { name: "Example profiles" }));
    expect(screen.queryByRole("heading", { name: "Try it with an example profile" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Replies" })).toBeInTheDocument();
  });
});
