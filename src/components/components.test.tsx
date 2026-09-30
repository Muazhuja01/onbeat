import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./composer";
import { CueLight } from "./cue-light";
import { ReplyList } from "./reply-list";
import { CaptionLog } from "./caption-log";
import { AnnouncerProvider, useAnnounce } from "./announcer";
import { ListenControl } from "./listen-control";
import { ResponseGap } from "./response-gap";
import { SettingsPanel } from "./settings-panel";
import type { Reply } from "@/lib/types";

const replies: Reply[] = [
  { text: "Large, please.", noteIds: [], source: "model" },
  { text: "My usual, please.", noteIds: [], source: "phrase" },
];

describe("ReplyList", () => {
  it("renders replies as buttons named by their text and speaks on click", async () => {
    const onSpeak = vi.fn();
    render(<ReplyList replies={replies} speaking={null} status="ready" onSpeak={onSpeak} onStop={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Large, please." }));
    expect(onSpeak).toHaveBeenCalledWith("Large, please.");
    expect(screen.getByText("From your phrases")).toBeInTheDocument();
  });

  it("turns the speaking reply into a stop button", async () => {
    const onStop = vi.fn();
    render(<ReplyList replies={replies} speaking="Large, please." status="ready" onSpeak={vi.fn()} onStop={onStop} />);
    await userEvent.click(screen.getByRole("button", { name: "Stop saying: Large, please." }));
    expect(onStop).toHaveBeenCalled();
  });

  it("explains the empty state", () => {
    render(<ReplyList replies={[]} speaking={null} status="idle" onSpeak={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByText("Replies will appear here when someone talks to you or you start typing.")).toBeInTheDocument();
  });
});

describe("CueLight", () => {
  it("says what is happening in text", () => {
    const { rerender } = render(<CueLight status="ready" />);
    expect(screen.getByText("Replies ready")).toBeInTheDocument();
    rerender(<CueLight status="thinking" />);
    expect(screen.getByText("Finding replies…")).toBeInTheDocument();
    rerender(<CueLight status="paused" />);
    expect(screen.getByText("Suggestions paused")).toBeInTheDocument();
  });
});

describe("Composer", () => {
  it("speaks on Enter and on the Speak button", async () => {
    const onSpeak = vi.fn();
    render(<Composer value="hello" onChange={vi.fn()} onSpeak={onSpeak} onFocusReplies={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Type a reply"), "{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Speak" }));
    expect(onSpeak).toHaveBeenCalledTimes(2);
  });

  it("moves to the replies with the up arrow", async () => {
    const onFocusReplies = vi.fn();
    render(<Composer value="" onChange={vi.fn()} onSpeak={vi.fn()} onFocusReplies={onFocusReplies} />);
    await userEvent.type(screen.getByLabelText("Type a reply"), "{ArrowUp}");
    expect(onFocusReplies).toHaveBeenCalled();
  });
});

describe("CaptionLog", () => {
  it("labels who said each line", () => {
    render(
      <CaptionLog
        partnerName="Sam"
        turns={[
          { id: "1", speaker: "partner", text: "What size?", at: 1 },
          { id: "2", speaker: "user", text: "Large, please.", at: 2 },
        ]}
      />,
    );
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("What size?")).toBeInTheDocument();
  });

  it("shows a live line while the partner is talking", () => {
    render(<CaptionLog turns={[]} partnerName="Sam" partial="What size" />);
    expect(screen.getByText("What size…")).toBeInTheDocument();
    expect(screen.getByText("(still talking)")).toBeInTheDocument();
    expect(screen.queryByText(/will appear here/)).not.toBeInTheDocument();
  });

  it("keeps the newest line in view only while you haven't scrolled back, and never scrolls the page", () => {
    const pageScroll = vi.fn();
    Element.prototype.scrollIntoView = pageScroll;
    const turns = [{ id: "1", speaker: "partner" as const, text: "Hi", at: 1 }];
    const { rerender } = render(<CaptionLog turns={turns} partnerName="Sam" partial="What" />);
    const list = screen.getByRole("list");
    let top = 0;
    Object.defineProperty(list, "scrollHeight", { configurable: true, get: () => 1000 });
    Object.defineProperty(list, "clientHeight", { configurable: true, get: () => 200 });
    Object.defineProperty(list, "scrollTop", { configurable: true, get: () => top, set: (v: number) => (top = v) });

    rerender(<CaptionLog turns={turns} partnerName="Sam" partial="What size" />);
    expect(top).toBe(1000);

    // You scroll back to read an earlier line: new captions leave you there.
    top = 300;
    act(() => list.dispatchEvent(new Event("scroll")));
    rerender(<CaptionLog turns={turns} partnerName="Sam" partial="What size would" />);
    expect(top).toBe(300);

    // Back near the bottom: it follows the captions again.
    top = 790;
    act(() => list.dispatchEvent(new Event("scroll")));
    rerender(<CaptionLog turns={turns} partnerName="Sam" partial="What size would you" />);
    expect(top).toBe(1000);
    expect(pageScroll).not.toHaveBeenCalled();
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });
});

describe("AnnouncerProvider", () => {
  function Announce({ calls }: { calls: [string, string?][] }) {
    const announce = useAnnounce();
    return (
      <button type="button" onClick={() => calls.forEach(([text, key]) => announce(text, key))}>
        Go
      </button>
    );
  }

  it("announces each caption and only the latest message with the same key, one per second", async () => {
    vi.useFakeTimers();
    try {
      const calls: [string, string?][] = [
        ["Sam said: What size?"],
        ["1 reply ready", "replies"],
        ["3 replies ready", "replies"],
      ];
      render(
        <AnnouncerProvider>
          <Announce calls={calls} />
        </AnnouncerProvider>,
      );
      const region = screen.getByRole("status");
      act(() => screen.getByRole("button", { name: "Go" }).click());
      act(() => vi.advanceTimersByTime(60));
      expect(region).toHaveTextContent("Sam said: What size?");
      act(() => vi.advanceTimersByTime(500));
      expect(region).toHaveTextContent("Sam said: What size?");
      act(() => vi.advanceTimersByTime(600));
      expect(region).toHaveTextContent("3 replies ready");
      act(() => vi.advanceTimersByTime(2000));
      expect(region).toHaveTextContent("3 replies ready");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps only the newest five messages when captions pile up", () => {
    vi.useFakeTimers();
    try {
      const calls: [string, string?][] = Array.from({ length: 8 }, (_, i) => [`Line ${i + 1}`]);
      render(
        <AnnouncerProvider>
          <Announce calls={calls} />
        </AnnouncerProvider>,
      );
      const region = screen.getByRole("status");
      act(() => screen.getByRole("button", { name: "Go" }).click());
      const seen: string[] = [];
      for (let i = 0; i < 300; i++) {
        act(() => vi.advanceTimersByTime(25));
        const text = region.textContent ?? "";
        if (text && text !== seen.at(-1)) seen.push(text);
      }
      expect(seen).toEqual(["Line 4", "Line 5", "Line 6", "Line 7", "Line 8"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ListenControl", () => {
  it("offers to listen and says what happens the first time", () => {
    render(<ListenControl hearing={null} status="off" progress={0} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: "Listen" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/downloads speech recognition to this device/)).toBeInTheDocument();
  });

  it("shows progress while getting ready, then says it is listening", () => {
    const { rerender } = render(<ListenControl hearing={null} status="loading" progress={42} onToggle={() => {}} />);
    expect(screen.getByText("Getting speech recognition ready…")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    rerender(<ListenControl hearing={null} status="listening" progress={100} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: "Listen" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Listening. Their words appear in the conversation.")).toBeInTheDocument();
  });

  it("explains a blocked microphone", () => {
    render(<ListenControl hearing={null} status="denied" progress={0} onToggle={() => {}} />);
    expect(
      screen.getByText("Microphone is off. You can still type replies. Turn it on in your browser's site settings."),
    ).toBeInTheDocument();
  });

  it("says what happened and what to do when hearing stops on its own", () => {
    const { rerender } = render(<ListenControl hearing={null} status="interrupted" progress={0} onToggle={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "The microphone stopped. Check that it's connected, then press Listen to try again.",
    );
    expect(screen.getByRole("button", { name: "Listen" })).toHaveAttribute("aria-pressed", "false");
    rerender(<ListenControl hearing={null} status="error" progress={0} onToggle={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Speech recognition couldn't load or stopped working. Check your connection, then press Listen to try again.",
    );
  });
});

describe("ResponseGap", () => {
  it("shows the last and the median gap", () => {
    render(<ResponseGap gaps={[400, 1200, 800]} />);
    expect(screen.getByText("Replies were ready 0.8 s after they stopped. Median 0.8 s over 3 turns.")).toBeInTheDocument();
  });
});

describe("SettingsPanel", () => {
  it("chooses a theme and turns the number keys off", async () => {
    const onTheme = vi.fn();
    const onDigitKeys = vi.fn();
    render(<SettingsPanel theme="system" digitKeys={true} cloudCaptions={false} onTheme={onTheme} onDigitKeys={onDigitKeys} onCloudCaptions={() => {}} />);
    await userEvent.click(screen.getByText("Settings"));
    expect(screen.getByRole("radio", { name: "Match this device" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "High contrast" }));
    expect(onTheme).toHaveBeenCalledWith("contrast");
    await userEvent.click(screen.getByRole("checkbox", { name: /Number keys speak replies/ }));
    expect(onDigitKeys).toHaveBeenCalledWith(false);
  });

  it("turns clearer captions on, saying where the audio goes", async () => {
    const onCloudCaptions = vi.fn();
    render(<SettingsPanel theme="system" digitKeys={true} cloudCaptions={false} onTheme={() => {}} onDigitKeys={() => {}} onCloudCaptions={onCloudCaptions} />);
    await userEvent.click(screen.getByText("Settings"));
    const box = screen.getByRole("checkbox", { name: "Clearer captions" });
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription(/sent to Deepgram, through Cloudflare/);
    await userEvent.click(box);
    expect(onCloudCaptions).toHaveBeenCalledWith(true);
  });

  it("lists the keyboard shortcuts", async () => {
    render(<SettingsPanel theme="dark" digitKeys={false} cloudCaptions={false} onTheme={() => {}} onDigitKeys={() => {}} onCloudCaptions={() => {}} />);
    await userEvent.click(screen.getByText("Settings"));
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Number keys speak replies/ })).not.toBeChecked();
    for (const key of ["1, 2, 3", "Alt+1, Alt+2", "Enter", "Up arrow", "Esc"]) expect(screen.getByText(key)).toBeInTheDocument();
  });
});
