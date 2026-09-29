"use client";

import { Stop } from "@phosphor-icons/react";
import { forwardRef } from "react";
import type { SuggestStatus } from "@/lib/conversation/reducer";
import type { Reply } from "@/lib/types";
import { CueLight } from "./cue-light";

interface Props {
  replies: Reply[];
  speaking: string | null;
  status: SuggestStatus;
  onSpeak: (text: string) => void;
  onStop: () => void;
}

export const ReplyList = forwardRef<HTMLElement, Props>(function ReplyList({ replies, speaking, status, onSpeak, onStop }, ref) {
  return (
    <section ref={ref} id="replies" tabIndex={-1} aria-labelledby="replies-heading" className="flex flex-col gap-3 outline-none">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="replies-heading" className="text-body font-bold">
          Replies
        </h2>
        <CueLight status={status} />
      </div>
      {replies.length === 0 ? (
        <p className="text-body text-muted">Replies will appear here when someone talks to you or you start typing.</p>
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
                  className={`flex min-h-16 w-full items-center gap-4 rounded-control border-2 px-4 py-3 text-left transition-[border-color,background-color,transform] duration-150 active:translate-y-px ${
                    isSpeaking ? "border-ink bg-cue text-on-cue" : "border-ink/15 bg-surface text-ink hover:border-ink/50"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`grid size-9 shrink-0 place-items-center rounded-full border-2 text-label font-bold ${
                      isSpeaking ? "border-on-cue" : "border-ink/30 text-muted"
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
        </ol>
      )}
    </section>
  );
});
