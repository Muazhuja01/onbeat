"use client";

import { Stop } from "@phosphor-icons/react";
import { forwardRef, type ReactNode } from "react";
import type { SuggestStatus } from "@/lib/conversation/reducer";
import type { Reply } from "@/lib/types";
import { CueLight } from "./cue-light";

/** Room kept for this many replies, so the list doesn't change height as they come and go. */
const SLOTS = 3;

interface Props {
  replies: Reply[];
  /** Keep room for three replies even before there are any (once a conversation has started). */
  reserve?: boolean;
  speaking: string | null;
  status: SuggestStatus;
  onSpeak: (text: string) => void;
  onStop: () => void;
  /** Shown to the right of the cue light (quick reactions). */
  aside?: ReactNode;
  /** Shown under the cue row (your phrases). */
  below?: ReactNode;
}

export const ReplyList = forwardRef<HTMLElement, Props>(function ReplyList({ replies, reserve = false, speaking, status, onSpeak, onStop, aside, below }, ref) {
  return (
    <section ref={ref} id="replies" tabIndex={-1} aria-labelledby="replies-heading" className="flex flex-col gap-3 outline-none">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 id="replies-heading" className="sr-only">
          Replies
        </h2>
        <CueLight status={status} />
        <div className="ml-auto">{aside}</div>
      </div>
      {below}
      {replies.length === 0 ? (
        // min-h: three 4rem slots and the gaps between them.
        <p className={`text-body text-muted ${reserve ? "min-h-[13.5rem]" : ""}`}>Replies show up here when someone talks to you, or as you type.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {replies.map((reply, i) => {
            const isSpeaking = speaking === reply.text;
            return (
              <li key={`${i}-${reply.text}`}>
                <button
                  type="button"
                  aria-keyshortcuts={String(i + 1)}
                  aria-label={isSpeaking ? `Stop saying: ${reply.text}` : undefined}
                  onClick={() => (isSpeaking ? onStop() : onSpeak(reply.text))}
                  className={`reply-in flex min-h-16 w-full items-center gap-4 rounded-2xl border-2 px-4 py-3 text-left transition-[border-color,background-color,transform] duration-150 active:translate-y-px ${
                    isSpeaking ? "border-ink bg-cue text-on-cue" : "border-edge bg-raised text-ink shadow-lift hover:border-ink/50"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`grid size-9 shrink-0 place-items-center rounded-full border-2 text-label font-bold ${
                      isSpeaking ? "border-on-cue" : "border-transparent bg-ground text-ink"
                    }`}
                  >
                    {isSpeaking ? <Stop weight="fill" size={16} /> : i + 1}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-reply font-semibold break-words">{reply.text}</span>
                    {reply.source === "phrase" && !isSpeaking && <span className="text-label text-muted">From your phrases</span>}
                    {isSpeaking && <span className="text-label font-bold">Speaking. Tap to stop.</span>}
                  </span>
                </button>
              </li>
            );
          })}
          {Array.from({ length: Math.max(0, SLOTS - replies.length) }, (_, i) => (
            <li key={`slot-${i}`} aria-hidden="true" className="min-h-16" />
          ))}
        </ol>
      )}
    </section>
  );
});
