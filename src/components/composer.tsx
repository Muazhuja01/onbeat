"use client";

import { SpeakerHigh } from "@phosphor-icons/react";
import type { ReactNode } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSpeak: (text: string) => void;
  onFocusReplies: () => void;
  /** Shown before the box, such as "+ They said". */
  before?: ReactNode;
}

export function Composer({ value, onChange, onSpeak, onFocusReplies, before }: Props) {
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSpeak(value);
      }}
    >
      <label htmlFor="composer" className="typing-quiet text-label text-muted">
        Type a reply
      </label>
      {/* One row on phones, so it keeps the height of the "What they said" box that replaces it. */}
      <div className="flex flex-wrap gap-3 max-sm:flex-nowrap">
        {before}
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
          className="min-h-14 min-w-32 flex-1 max-sm:min-w-0 rounded-control border-2 border-muted bg-raised px-4 text-body text-ink placeholder:text-muted"
        />
        <button
          type="submit"
          className="flex min-h-14 shrink-0 items-center justify-center gap-2 rounded-control border-2 border-ink bg-ink px-5 text-body font-bold text-ground transition-[transform] duration-150 active:translate-y-px max-[24rem]:w-14 max-[24rem]:px-0"
        >
          <SpeakerHigh aria-hidden="true" size={22} weight="bold" />
          {/* Narrow phones show the speaker only, so the type box keeps room; the name stays "Speak". */}
          <span className="max-[24rem]:sr-only">Speak</span>
        </button>
      </div>
    </form>
  );
}
