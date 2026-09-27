import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./composer";
import { CueLight } from "./cue-light";
import { ReplyList } from "./reply-list";
import { CaptionLog } from "./caption-log";
import { AnnouncerProvider, useAnnounce } from "./announcer";
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
});
