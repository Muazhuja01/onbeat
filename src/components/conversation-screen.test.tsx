import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as browserMemory from "@/lib/memory/browser";
import { MemoryStore } from "@/lib/memory/store";
import type { SuggestInput, SuggestUpdate } from "@/lib/suggest/client";
import type { Reply } from "@/lib/types";
import { DEFAULT_VOICE } from "@/lib/voice/choices";

const h = vi.hoisted(() => {
  type Listener = (v: unknown) => void;
  const listeners: Record<string, Set<Listener>> = {
    start: new Set(),
    end: new Set(),
    sampleStart: new Set(),
    sampleEnd: new Set(),
    mode: new Set(),
    progress: new Set(),
    waiting: new Set(),
    fallback: new Set(),
    source: new Set(),
    backup: new Set(),
  };
  const voice = {
    mode: "basic" as const,
    source: "waking" as const,
    on(event: string, cb: Listener) {
      listeners[event].add(cb);
      return () => listeners[event].delete(cb);
    },
    load: () => {},
    prepare: () => {},
    prepareReplies: (() => {}) as (texts: string[]) => void,
    speak: async (text: string) => {
      for (const cb of listeners.start) cb(text);
    },
    sample: async (text: string) => {
      for (const cb of listeners.sampleStart) cb(text);
    },
    stop: () => {},
  };
  const setCurrentVoice = vi.fn();
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
    turnRevised: new Set(),
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
  return { voice, setCurrentVoice, emit, requests, hearing, hear, learnBodies, setLearnAnswer, postLearn };
});

const flags = vi.hoisted(() => ({ assistant: true }));
vi.mock("@/lib/assist/enabled", () => ({
  get ASSISTANT_ENABLED() {
    return flags.assistant;
  },
}));
vi.mock("@/lib/voice/browser", () => ({ getBrowserVoice: () => h.voice, setCurrentVoice: h.setCurrentVoice }));
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
  await userEvent.click(screen.getByRole("button", { name: "They said" }));
  await userEvent.type(screen.getByLabelText("What they said"), text);
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
}

async function startWithMaya() {
  render(<ConversationScreen />);
  await userEvent.click(await screen.findByRole("button", { name: "Try a demo first" }));
  await userEvent.click(await screen.findByRole("button", { name: /^Maya/ }));
  await screen.findByRole("heading", { name: "Replies" });
}

/** Goes through setup (already on screen) for `name`, choosing a male voice if asked. */
async function fillSetup(name: string, male = false) {
  await userEvent.type(await screen.findByLabelText("What's your name?"), `${name}{Enter}`);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  if (male) await userEvent.click(screen.getByRole("radio", { name: "Male" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Finish" }));
  await screen.findByRole("heading", { name: "Replies" });
}

async function setUpPriya() {
  render(<ConversationScreen />);
  await fillSetup("Priya");
}

/** Opens the profile menu and picks an item from it. */
async function fromMenu(profile: string, item: string | RegExp) {
  await userEvent.click(screen.getByRole("button", { name: profile }));
  await userEvent.click(screen.getByRole("button", { name: item }));
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
  h.setCurrentVoice.mockClear();
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

    await userEvent.click(screen.getByRole("button", { name: "They said" }));
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
    // It can be dismissed once read.
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Profiles and notes won't be saved in this window.")).toBeNull();
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
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(screen.getByLabelText("Name", { selector: "#person-name" }), "Sam");
    await userEvent.type(screen.getByLabelText("Who they are to you"), "my barista");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("option", { name: "Sam" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Priya" })).toBeInTheDocument();
    expect(screen.getByText("You can add or change notes any time from your profile menu.")).toBeInTheDocument();
  });

  it("prepares the on-screen replies again after a voice is saved", async () => {
    await setUpPriya();
    await partnerSays("What size?");
    answer("Large, please.");
    const prepare = vi.spyOn(h.voice, "prepareReplies");
    await userEvent.click(screen.getByRole("button", { name: "Priya" }));
    await userEvent.click(screen.getByRole("button", { name: /^Voice:/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Faster" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { name: "Replies" });
    await waitFor(() => expect(prepare).toHaveBeenCalledWith(["Large, please."]));
    prepare.mockRestore();
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

describe("ConversationScreen new conversation", () => {
  const newConversation = () => screen.queryByRole("button", { name: "New conversation" });

  it("shows the button only once there is something to clear", async () => {
    await startWithMaya();
    expect(newConversation()).toBeNull();
    await partnerSays("What size?");
    expect(newConversation()).toBeInTheDocument();
  });

  it("asks first, and Cancel changes nothing", async () => {
    await startWithMaya();
    await partnerSays("What size?");
    await userEvent.click(newConversation()!);
    expect(screen.getByText("Clear this conversation? It isn't saved anywhere.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Clear this conversation? It isn't saved anywhere.")).toBeNull();
    expect(screen.getByText("What size?")).toBeInTheDocument();
    expect(newConversation()).toHaveFocus();
  });

  it("clears the lines, replies, last said line and reply box, and keeps the place and person", async () => {
    await startWithMaya();
    const place = (screen.getByLabelText("Place") as HTMLSelectElement).value;
    const person = (screen.getByLabelText("Talking with") as HTMLSelectElement).value;
    await partnerSays("What size?");
    answer("Large, please.");
    await userEvent.click(await screen.findByRole("button", { name: /Large, please./ }));
    await userEvent.type(screen.getByLabelText("Type a reply"), "and a muffin");
    await userEvent.click(screen.getByRole("button", { name: "They said" }));
    await userEvent.type(screen.getByLabelText("What they said"), "Anything");

    await userEvent.click(newConversation()!);
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.queryByText("What size?")).toBeNull();
    expect(screen.queryByRole("button", { name: /Large, please./ })).toBeNull();
    expect(screen.getByText("Ready when you are")).toBeInTheDocument();
    expect(screen.getByLabelText("Type a reply")).toHaveValue("");
    expect(screen.queryByLabelText("What they said")).toBeNull();
    expect(screen.getByLabelText("Place")).toHaveValue(place);
    expect(screen.getByLabelText("Talking with")).toHaveValue(person);
    expect(newConversation()).toBeNull();
    expect(screen.getByLabelText("Type a reply")).toHaveFocus();
    // Announcements go out one a second, after the caption line and replies queued above.
    await waitFor(() => expect(liveRegion()).toHaveTextContent("Conversation cleared."), { timeout: 5000 });
  });

  it("stops speech and drops a reply that arrives after clearing", async () => {
    await startWithMaya();
    await partnerSays("What size?");
    answer("Large, please.");
    await userEvent.click(await screen.findByRole("button", { name: /Large, please./ }));
    await partnerSays("Anything else?");
    await userEvent.click(newConversation()!);
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(h.voice.stop).toHaveBeenCalled();
    answer("No, thank you.");
    expect(screen.queryByRole("button", { name: /No, thank you./ })).toBeNull();
  });

  it("sends the finished conversation's lines for suggested notes", async () => {
    await setUpPriya();
    await partnerSays("Your new carer Ana starts on Monday.");
    await userEvent.type(screen.getByLabelText("Type a reply"), "Great, thanks for telling me{Enter}");
    expect(h.learnBodies).toHaveLength(0);
    await userEvent.click(newConversation()!);
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(h.learnBodies).toHaveLength(1));
    expect(h.learnBodies[0].lines.map((l) => l.text)).toEqual(["Your new carer Ana starts on Monday.", "Great, thanks for telling me"]);
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

  it("keeps listening while a reply waits for the voice, and pauses once it plays", async () => {
    await startWithMaya();
    await partnerSays("What size?");
    answer("Large, please.");
    await userEvent.click(screen.getByRole("button", { name: "Large, please." }));
    act(() => h.emit("waiting", true));
    expect(h.hearing.resume).toHaveBeenLastCalledWith(0);
    vi.mocked(h.hearing.pause).mockClear();
    act(() => h.emit("waiting", false));
    expect(h.hearing.pause).toHaveBeenCalled();
  });
});

describe("ConversationScreen voice", () => {
  const MALE = { gender: "male", accent: "american", style: "deep", speed: "normal", v: 2 };
  const lastVoice = () => h.setCurrentVoice.mock.calls.at(-1)?.[0];

  it("prepares only the replies on screen, in order", async () => {
    const prepare = vi.spyOn(h.voice, "prepareReplies");
    await startWithMaya();
    await partnerSays("What size?");
    answer("Large, please.", "Medium, please.");
    await waitFor(() => expect(prepare).toHaveBeenLastCalledWith(["Large, please.", "Medium, please."]));
    prepare.mockRestore();
  });

  it("says the voice is getting ready while a line waits for it", async () => {
    await startWithMaya();
    await userEvent.type(screen.getByLabelText("Type a reply"), "Hello there{Enter}");
    act(() => h.emit("waiting", true));
    const said = screen.getByRole("region", { name: "Conversation" });
    expect(within(said).getByText("Getting your voice ready…")).toBeInTheDocument();
    act(() => h.emit("waiting", false));
    expect(within(said).queryByText("Getting your voice ready…")).toBeNull();
  });

  it("notes under the line when the device voice said it instead of the chosen one", async () => {
    await startWithMaya();
    await userEvent.type(screen.getByLabelText("Type a reply"), "Hello there{Enter}");
    act(() => h.emit("fallback", "Hello there"));
    const line = within(screen.getByRole("region", { name: "Conversation" })).getAllByRole("listitem").at(-1)!;
    expect(line).toHaveTextContent("Said in your device's voice: yours wasn't ready in time.");
  });

  it("notes under the line when the backup voice said it", async () => {
    await startWithMaya();
    await userEvent.type(screen.getByLabelText("Type a reply"), "Hello{Enter}");
    act(() => h.emit("backup", "Hello"));
    expect(await screen.findByText("Said in the backup voice: yours wasn't ready in time.")).toBeVisible();
  });

  it("doesn't speak a reply when a number is pressed while Settings is open", async () => {
    const speak = vi.spyOn(h.voice, "speak");
    await startWithMaya();
    await partnerSays("What size?");
    answer("Large, please.");
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await userEvent.keyboard("1");
    expect(speak).not.toHaveBeenCalled();
    speak.mockRestore();
  });

  it("goes from the reply box up to the first reply, past the quick reactions", async () => {
    await startWithMaya();
    await partnerSays("What size?");
    act(() => h.requests.at(-1)!.onUpdate({ replies: [reply("Large, please.")], reactions: [{ id: "r1", text: "Mm-hmm" }], done: true }));
    await userEvent.click(screen.getByLabelText("Type a reply"));
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("button", { name: "Large, please." })).toHaveFocus();
  });

  it("speaks in Tom's voice when his demo opens", async () => {
    render(<ConversationScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Try a demo first" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Tom/ }));
    await screen.findByRole("heading", { name: "Replies" });
    expect(lastVoice()).toEqual(MALE);
  });

  it("speaks in each profile's voice after switching between them", async () => {
    await setUpPriya();
    await fromMenu("Priya", "New profile");
    await fillSetup("Ravi", true);
    expect(lastVoice()).toEqual(MALE);
    await fromMenu("Ravi", "Switch to Priya");
    await waitFor(() => expect(screen.getByRole("button", { name: "Priya" })).toBeInTheDocument());
    expect(lastVoice()).toEqual(DEFAULT_VOICE);
    await fromMenu("Priya", "Switch to Ravi");
    await waitFor(() => expect(screen.getByRole("button", { name: "Ravi" })).toBeInTheDocument());
    expect(lastVoice()).toEqual(MALE);
  });

  it("keeps the old voice until the profile being switched to has opened", async () => {
    await setUpPriya();
    await fromMenu("Priya", "New profile");
    await fillSetup("Ravi", true);
    const real = browserMemory.openProfileMemory;
    let open = () => {};
    const spy = vi.spyOn(browserMemory, "openProfileMemory").mockImplementationOnce(async (reg, id) => {
      await new Promise<void>((r) => (open = r));
      return real(reg, id);
    });
    h.setCurrentVoice.mockClear();
    await fromMenu("Ravi", "Switch to Priya");
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(h.setCurrentVoice).not.toHaveBeenCalledWith(DEFAULT_VOICE);
    await act(async () => open());
    await waitFor(() => expect(screen.getByRole("button", { name: "Priya" })).toBeInTheDocument());
    expect(lastVoice()).toEqual(DEFAULT_VOICE);
    spy.mockRestore();
  });

  it("goes back to the default voice after the last profile is deleted", async () => {
    render(<ConversationScreen />);
    await fillSetup("Ravi", true);
    expect(lastVoice()).toEqual(MALE);
    await fromMenu("Ravi", "Delete this profile");
    await userEvent.click(screen.getByRole("button", { name: "Delete Ravi" }));
    await screen.findByRole("heading", { name: "Set up OnBeat" });
    expect(lastVoice()).toEqual(DEFAULT_VOICE);
  });

  it("offers the Settings voice row only on the conversation", async () => {
    await setUpPriya();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("button", { name: "Change voice" })).toBeInTheDocument();
    await fromMenu("Priya", "New profile");
    expect(screen.getByRole("heading", { name: "Set up OnBeat" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change voice" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await fromMenu("Priya", /^Voice:/);
    expect(screen.getByRole("heading", { name: "Your voice" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change voice" })).toBeNull();
  });

  it("pauses listening while a sample plays, and the sample is not something the user said", async () => {
    await setUpPriya();
    await fromMenu("Priya", /^Voice:/);
    await userEvent.click(screen.getByRole("button", { name: "Play a sample" }));
    expect(h.hearing.pause).toHaveBeenCalled();
    act(() => h.emit("sampleEnd", "Hi, I'm Priya. This is how I'll sound."));
    expect(h.hearing.resume).toHaveBeenCalledWith(400);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByRole("heading", { name: "Replies" });
    expect(screen.queryByText(/This is how I'll sound/)).toBeNull();
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
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
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

describe("ConversationScreen cloud caption corrections", () => {
  const piece = (text: string, startedAt: number, endedAt: number) => act(() => h.hear("turnEnd", { text, startedAt, endedAt }));
  const lines = () => within(screen.getByRole("region", { name: "Conversation" })).getAllByRole("listitem").map((li) => li.textContent);

  it("corrects the line in place and asks for replies to the corrected words, without reading it out again", async () => {
    await startWithMaya();
    piece("So the fizzy oh moved", 1_000, 2_000);
    await waitFor(() => expect(liveRegion().textContent).toBe("Sam said: So the fizzy oh moved"), { timeout: 2000 });
    act(() => h.hear("turnRevised", { from: "So the fizzy oh moved", to: "So the physio moved." }));
    expect(lines()).toEqual(["SamSo the physio moved."]);
    expect(h.requests.at(-1)?.input).toMatchObject({ partnerSaid: "So the physio moved.", priority: "final" });
    await new Promise((r) => setTimeout(r, 1500));
    expect(liveRegion().textContent).not.toContain("physio");
  });

  it("learns from the corrected line", async () => {
    await setUpPriya();
    piece("Your fizzy oh moved", 1_000, 2_000);
    act(() => h.hear("turnRevised", { from: "Your fizzy oh moved", to: "Your physio moved." }));
    await userEvent.type(screen.getByLabelText("Type a reply"), "OK, thanks{Enter}");
    hidePage();
    await waitFor(() => expect(h.learnBodies).toHaveLength(1));
    expect(h.learnBodies[0].lines.map((l) => [l.speaker, l.text])).toEqual([
      ["partner", "Your physio moved."],
      ["user", "OK, thanks"],
    ]);
  });
});

describe("ConversationScreen pauses in one line", () => {
  /** A piece of the partner's speech, as hearing reports it when they pause. */
  const piece = (text: string, startedAt: number, endedAt: number) => act(() => h.hear("turnEnd", { text, startedAt, endedAt }));
  const lines = () => within(screen.getByRole("region", { name: "Conversation" })).getAllByRole("listitem").map((li) => li.textContent);
  const joinBox = () => screen.getByRole("checkbox", { name: "Keep the other person's pauses in one line" });

  it("adds what they say within 3 s of a pause to the same line, and asks with the whole line", async () => {
    await startWithMaya();
    piece("So the physio", 1_000, 2_000);
    expect(lines()).toEqual(["SamSo the physio"]);
    act(() => h.hear("speechStart", 4_000));
    act(() => h.hear("partial", "moved to Thursdays"));
    // The live caption shows only the new words, under the line they will join.
    expect(lines()).toEqual(["SamSo the physio", "Sam (still talking)moved to Thursdays…"]);
    expect(h.requests.at(-1)?.input).toMatchObject({ partnerSaid: "So the physio moved to Thursdays", priority: "speculative" });
    piece("moved to Thursdays, is that OK?", 4_000, 6_000);
    expect(lines()).toEqual(["SamSo the physio moved to Thursdays, is that OK?"]);
    expect(h.requests.at(-1)?.input).toMatchObject({ partnerSaid: "So the physio moved to Thursdays, is that OK?", priority: "final" });
    // More than 3 s later: a new line.
    piece("Anything else?", 9_001, 10_000);
    expect(lines()).toEqual(["SamSo the physio moved to Thursdays, is that OK?", "SamAnything else?"]);
  });

  it("reads out only the new words when a line grows", async () => {
    await startWithMaya();
    piece("So the physio", 1_000, 2_000);
    await waitFor(() => expect(liveRegion().textContent).toBe("Sam said: So the physio"), { timeout: 2000 });
    piece("moved to Thursdays", 3_000, 4_000);
    await waitFor(() => expect(liveRegion().textContent).toBe("Sam said: moved to Thursdays"), { timeout: 2500 });
  });

  it("keeps each piece on its own line with the setting off", async () => {
    await startWithMaya();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(joinBox()).toBeChecked();
    await userEvent.click(joinBox());
    piece("So the physio", 1_000, 2_000);
    piece("moved to Thursdays", 3_000, 4_000);
    expect(lines()).toEqual(["SamSo the physio", "Sammoved to Thursdays"]);
    await userEvent.click(joinBox());
  });

  it("never carries a line on across New conversation", async () => {
    await startWithMaya();
    piece("So the physio", 1_000, 2_000);
    await userEvent.click(screen.getByRole("button", { name: "New conversation" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    piece("moved to Thursdays", 3_000, 4_000);
    expect(lines()).toEqual(["Sammoved to Thursdays"]);
  });

  it("learns from the whole line once", async () => {
    await setUpPriya();
    piece("Your physio", 1_000, 2_000);
    piece("moved to Thursdays.", 3_000, 4_000);
    await userEvent.type(screen.getByLabelText("Type a reply"), "OK, thanks{Enter}");
    hidePage();
    await waitFor(() => expect(h.learnBodies).toHaveLength(1));
    expect(h.learnBodies[0].lines.map((l) => [l.speaker, l.text])).toEqual([
      ["partner", "Your physio moved to Thursdays."],
      ["user", "OK, thanks"],
    ]);
  });
});
