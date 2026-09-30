import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  type LearnRequest = import("@/lib/learning/protocol").LearnRequest;
  type Proposal = import("@/lib/learning/protocol").Proposal;
  const learnBodies: LearnRequest[] = [];
  let learnAnswer: (body: LearnRequest) => Proposal[] = () => [];
  const setLearnAnswer = (f: (body: LearnRequest) => Proposal[]) => {
    learnAnswer = f;
  };
  const postLearn = async (body: LearnRequest) => {
    learnBodies.push(body);
    return { ok: true as const, proposals: learnAnswer(body) };
  };
  return { voice, emit, requests, hearing, hear, learnBodies, setLearnAnswer, postLearn };
});

const flags = vi.hoisted(() => ({ assistant: true }));
vi.mock("@/lib/assist/enabled", () => ({
  get ASSISTANT_ENABLED() {
    return flags.assistant;
  },
}));
vi.mock("@/lib/voice/browser", () => ({ getBrowserVoice: () => h.voice }));
vi.mock("@/lib/hearing/browser", () => ({ getBrowserHearing: () => h.hearing }));
vi.mock("@/lib/learning/client", () => ({ postLearnBatch: (body: import("@/lib/learning/protocol").LearnRequest) => h.postLearn(body) }));

vi.mock("@/lib/memory/browser", async () => {
  const { MemoryStore } = await import("@/lib/memory/store");
  const { ProfileRegistry } = await import("@/lib/profiles/registry");
  const { memoryKeyValue } = await import("@/lib/profiles/kv");
  return {
    // A fresh, empty browser for every render.
    getBrowserRegistry: () => ProfileRegistry.open(memoryKeyValue()),
    openProfileMemory: (reg: import("@/lib/profiles/registry").ProfileRegistry, id: string) => MemoryStore.create({ persist: reg.persistFor(id) }),
    openDemoMemory: async (p: { notes: never[]; phrases: never[] }) => {
      const store = await MemoryStore.create();
      await store.replaceAll(p.notes, p.phrases);
      return store;
    },
  };
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
  await userEvent.click(await screen.findByRole("button", { name: "Try a demo first" }));
  await userEvent.click(await screen.findByRole("button", { name: /^Maya/ }));
  await screen.findByRole("heading", { name: "Replies" });
}

async function setUpPriya() {
  render(<ConversationScreen />);
  await userEvent.type(await screen.findByLabelText("What's your name?"), "Priya{Enter}");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Finish" }));
  await screen.findByRole("heading", { name: "Replies" });
}

/** The page goes to the background, which sends any queued lines. */
function hidePage() {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
}

const liveRegion = () => document.querySelector<HTMLElement>('[aria-live="polite"]')!;

beforeEach(() => {
  h.requests.length = 0;
  h.voice.stop = vi.fn();
  h.hearing.start = vi.fn(async () => {});
  h.hearing.stop = vi.fn();
  h.hearing.pause = vi.fn();
  h.hearing.resume = vi.fn();
  h.learnBodies.length = 0;
  h.setLearnAnswer(() => []);
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

    await userEvent.click(screen.getByRole("button", { name: "Demo: Maya" }));
    await userEvent.click(screen.getByRole("button", { name: "Try another demo" }));
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

  it("stops speech when another view covers the conversation while speaking", async () => {
    await startWithMaya();
    await partnerSays("What size?");
    answer("Large, please.");
    await userEvent.click(screen.getByRole("button", { name: "Large, please." }));
    expect(screen.getByRole("button", { name: "Stop saying: Large, please." })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Demo: Maya" }));
    expect(h.voice.stop).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Try another demo" }));
    expect(h.voice.stop).toHaveBeenCalledTimes(1);
  });

  it("keeps profiles for this visit when loading them fails, instead of staying blank", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(browserMemory, "getBrowserRegistry").mockRejectedValueOnce(new Error("indexeddb boom"));

    render(<ConversationScreen />);

    // The page recovers with profiles kept in memory instead of staying blank forever.
    await screen.findByRole("heading", { name: "Set up OnBeat" });
    await screen.findByText("Profiles and notes won't be saved in this window.");
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

  it("opens on setup with no profiles, and a finished setup shows the conversation", async () => {
    render(<ConversationScreen />);
    await userEvent.type(await screen.findByLabelText("What's your name?"), "Priya{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(screen.getByLabelText("Name", { selector: "#person-name" }), "Sam");
    await userEvent.type(screen.getByLabelText("Who they are to you"), "my barista");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("option", { name: "Sam" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Priya" })).toBeInTheDocument();
    expect(screen.getByText("You can add or change notes any time from your profile menu.")).toBeInTheDocument();
  });

  it("goes back from the demo list to setup", async () => {
    render(<ConversationScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Try a demo first" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Set up OnBeat" })).toBeInTheDocument();
  });

  it("edits notes, and a deleted person leaves the Talking with list", async () => {
    await startWithMaya();
    await userEvent.click(screen.getByRole("button", { name: "Demo: Maya" }));
    await userEvent.click(screen.getByRole("button", { name: "Set up your own profile" }));
    await userEvent.type(screen.getByLabelText("What's your name?"), "Priya{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(screen.getByLabelText("Name", { selector: "#person-name" }), "Sam");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByRole("option", { name: "Sam" });
    expect(screen.queryByText("Nothing you do here is saved.")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Talking with"), "Sam");

    await userEvent.click(screen.getByRole("button", { name: "Priya" }));
    await userEvent.click(screen.getByRole("button", { name: "Your notes" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete: Sam" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("option", { name: "Sam" })).toBeNull());
    expect(screen.getByLabelText("Talking with")).toHaveValue("");
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

describe("ConversationScreen learning", () => {
  it("learns from the partner and the user, and a kept suggestion becomes a note", async () => {
    h.setLearnAnswer((body) => [{ action: "add", kind: "person", name: "Ana", text: "Ana is my new carer. She starts on Monday.", lineIds: [body.lines[0].id] }]);
    await setUpPriya();
    await partnerSays("Your new carer Ana starts on Monday.");
    await userEvent.type(screen.getByLabelText("Type a reply"), "Great, thanks for telling me{Enter}");
    hidePage();
    await waitFor(() => expect(h.learnBodies).toHaveLength(1));
    expect(h.learnBodies[0].lines.map((l) => [l.speaker, l.text])).toEqual([
      ["partner", "Your new carer Ana starts on Monday."],
      ["user", "Great, thanks for telling me"],
    ]);

    const toggle = await screen.findByRole("button", { name: "Priya, 1 suggested note" });
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: "Suggested notes (1)" }));
    expect(screen.getByText(/The other person said: .Your new carer Ana starts on Monday../)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep: Ana is my new carer. She starts on Monday." }));
    expect(await screen.findByText("Nothing to review. OnBeat suggests notes from your conversations; you choose what to keep.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    await userEvent.click(screen.getByRole("button", { name: "Priya" }));
    await userEvent.click(screen.getByRole("button", { name: "Your notes" }));
    expect(screen.getByText("Ana is my new carer. She starts on Monday.")).toBeInTheDocument();
  });

  it("does not learn from a reply tapped as it is", async () => {
    await setUpPriya();
    await partnerSays("How was your weekend?");
    answer("It was lovely, thanks.");
    await userEvent.click(await screen.findByRole("button", { name: /It was lovely, thanks./ }));
    await partnerSays("Did you do anything fun?");
    hidePage();
    await waitFor(() => expect(h.learnBodies).toHaveLength(1));
    expect(h.learnBodies[0].lines.map((l) => l.text)).toEqual(["How was your weekend?", "Did you do anything fun?"]);
  });

  it("speaks a quick phrase without learning from it or changing its tie", async () => {
    // Setup replaces the store's contents, so add the quick phrase right after it.
    const realReplace = MemoryStore.prototype.replaceAll;
    const replaceAll = vi.spyOn(MemoryStore.prototype, "replaceAll").mockImplementation(async function (this: MemoryStore, ...args) {
      await realReplace.apply(this, args);
      await this.addQuickPhrase("My usual, please.", {});
    });
    const speak = vi.spyOn(h.voice, "speak");
    const addPhrase = vi.spyOn(MemoryStore.prototype, "addPhrase");

    await setUpPriya();
    await partnerSays("Your usual order?");
    const row = await screen.findByRole("group", { name: "Your phrases" });
    await userEvent.click(within(row).getByRole("button", { name: "My usual, please." }));
    expect(speak).toHaveBeenCalledWith("My usual, please.");
    await waitFor(() => expect(addPhrase).toHaveBeenCalled());
    await addPhrase.mock.results[0].value;
    hidePage();
    await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 50));
    // The partner line alone is not sent; a learned user line would have sent both.
    expect(h.learnBodies).toHaveLength(0);
    const stored = (addPhrase.mock.contexts[0] as MemoryStore).phrases().find((p) => p.text === "My usual, please.")!;
    expect(stored.quick).toBe(true);
    expect(stored.context.partnerId).toBeUndefined();

    replaceAll.mockRestore();
    speak.mockRestore();
    addPhrase.mockRestore();
  });

  it("never learns in a demo", async () => {
    await startWithMaya();
    await partnerSays("Your physio moved to Thursdays.");
    await partnerSays("Same time as before.");
    hidePage();
    await new Promise((r) => setTimeout(r, 50));
    expect(h.learnBodies).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Demo: Maya" }));
    expect(screen.queryByRole("button", { name: /Suggested notes/ })).toBeNull();
  });

  it("learns nothing with the setting off", async () => {
    await setUpPriya();
    await userEvent.click(screen.getByText("Settings"));
    const box = screen.getByRole("checkbox", { name: "Suggest notes from my conversations" });
    await userEvent.click(box);
    await partnerSays("Your physio moved to Thursdays.");
    await partnerSays("Same time as before.");
    hidePage();
    await new Promise((r) => setTimeout(r, 50));
    expect(h.learnBodies).toHaveLength(0);
    await userEvent.click(box);
  });
});

describe("ConversationScreen assistant", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function assistantWithACard() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { lines: { id: string; speaker: string }[] };
        const last = body.lines.filter((l) => l.speaker === "user").at(-1)!.id;
        return new Response(JSON.stringify({ say: "Here.", proposals: [{ action: "phrase", text: "Thank you.", lineIds: [last] }] }), { status: 200 });
      }),
    );
    await setUpPriya();
    await userEvent.click(screen.getByRole("button", { name: "Priya" }));
    await userEvent.click(screen.getByRole("button", { name: "Assistant" }));
    await userEvent.click(screen.getByRole("button", { name: "Make quick phrases" }));
    await screen.findByRole("button", { name: "Keep: Thank you." });
  }

  it("asks before the menu leaves the assistant with changes not kept", async () => {
    await assistantWithACard();
    await userEvent.click(screen.getByRole("button", { name: "Priya" }));
    await userEvent.click(screen.getByRole("button", { name: "Your notes" }));
    expect(screen.getByText("Leave without keeping 1 change?")).toBeVisible();
    expect(screen.getByRole("button", { name: "Keep: Thank you." })).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "Leave" })).toHaveFocus());

    await userEvent.click(screen.getByRole("button", { name: "Stay" }));
    await userEvent.click(screen.getByRole("button", { name: "Priya" }));
    await userEvent.click(screen.getByRole("button", { name: "New profile" }));
    expect(screen.getByText("Leave without keeping 1 change?")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(await screen.findByLabelText("What's your name?")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Assistant" })).toBeNull();
  });

  it("leaves for the chosen screen straight away when nothing is open", async () => {
    await assistantWithACard();
    await userEvent.click(screen.getByRole("button", { name: "Skip: Thank you." }));
    await userEvent.click(screen.getByRole("button", { name: "Priya" }));
    await userEvent.click(screen.getByRole("button", { name: "Suggested notes" }));
    expect(screen.queryByRole("heading", { name: "Assistant" })).toBeNull();
    expect(screen.queryByText(/Leave without keeping/)).toBeNull();
  });

  it("leaves the assistant out of the menu until it is switched on", async () => {
    flags.assistant = false;
    try {
      await setUpPriya();
      await userEvent.click(screen.getByRole("button", { name: "Priya" }));
      expect(screen.getByRole("button", { name: "Your notes" })).toBeVisible();
      expect(screen.queryByRole("button", { name: "Assistant" })).toBeNull();
    } finally {
      flags.assistant = true;
    }
  });
});
