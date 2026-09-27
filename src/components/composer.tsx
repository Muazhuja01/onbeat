"use client";

import { SpeakerHigh } from "@phosphor-icons/react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSpeak: (text: string) => void;
  onFocusReplies: () => void;
}

export function Composer({ value, onChange, onSpeak, onFocusReplies }: Props) {
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSpeak(value);
      }}
    >
      <label htmlFor="composer" className="text-label text-muted">
        Type a reply
      </label>
      <div className="flex gap-3">
        <input
          id="composer"
          name="reply"
          type="text"
          autoComplete="off"
          enterKeyHint="send"
          placeholder="Type or pick a reply…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Escape is handled once, by the screen's global shortcut handler.
            if (e.key === "ArrowUp") {
              e.preventDefault();
              onFocusReplies();
            }
          }}
          className="min-h-14 min-w-0 flex-1 rounded-control border-2 border-ink/30 bg-surface px-4 text-body text-ink placeholder:text-muted"
        />
        <button
          type="submit"
          className="flex min-h-14 items-center gap-2 rounded-control border-2 border-ink bg-ink px-5 text-body font-bold text-ground transition-[transform] duration-150 active:translate-y-px"
        >
          <SpeakerHigh aria-hidden="true" size={22} weight="bold" />
          Speak
        </button>
      </div>
    </form>
  );
}
