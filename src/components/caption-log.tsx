"use client";

import { useEffect, useRef, useState } from "react";
import type { Turn } from "@/lib/types";
import { primaryButton, secondaryButton } from "./ui";

/** How close to the end of the list still counts as following the newest line. */
const NEAR_END_PX = 64;

export function CaptionLog({
  turns,
  partnerName,
  partial = "",
  onNewConversation,
}: {
  turns: Turn[];
  partnerName: string;
  partial?: string;
  /** Clears the screen for the next conversation; asked about first. */
  onNewConversation?: () => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const [confirming, setConfirming] = useState(false);
  const newButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  // Set by Cancel: the New conversation button gets focus back once it's shown again.
  const cancelled = useRef(false);
  const hasLines = turns.length > 0 || partial !== "";
  useEffect(() => {
    if (confirming) cancelButton.current?.focus();
    else if (cancelled.current) {
      cancelled.current = false;
      newButton.current?.focus();
    }
  }, [confirming]);
  // False once you scroll back to read an earlier line; true again near the end.
  const following = useRef(true);
  const onScroll = () => {
    const el = list.current;
    if (el)
      following.current =
        el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_END_PX;
  };
  // The last line can grow when the other person carries it on after a pause.
  const lastText = turns.at(-1)?.text;
  useEffect(() => {
    // Scroll only the list, never the page, so the replies and reactions below
    // stay under your finger while captions update (spec 6.3). Instant, never
    // smooth, so reduced motion is respected.
    const el = list.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [turns.length, lastText, partial]);

  return (
    <section
      aria-labelledby="conversation-heading"
      className="flex min-h-0 flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="conversation-heading" className="text-body font-bold">
          Conversation
        </h2>
        {onNewConversation && hasLines && !confirming && (
          <button
            ref={newButton}
            type="button"
            className={`${secondaryButton} min-w-0 [overflow-wrap:anywhere]`}
            onClick={() => setConfirming(true)}
          >
            New conversation
          </button>
        )}
      </div>
      {confirming && hasLines && (
        <div className="flex flex-col gap-3">
          <p className="text-body font-bold break-words">
            Clear this conversation? It isn&apos;t saved anywhere.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={primaryButton}
              onClick={() => {
                setConfirming(false);
                onNewConversation?.();
              }}
            >
              Clear
            </button>
            <button
              ref={cancelButton}
              type="button"
              className={secondaryButton}
              onClick={() => {
                cancelled.current = true;
                setConfirming(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {turns.length === 0 && !partial ? (
        <p className="text-body text-muted">
          What the other person says will appear here in large text.
        </p>
      ) : (
        <ol
          ref={list}
          onScroll={onScroll}
          // A fixed height, so new lines scroll inside it instead of pushing what's below.
          className="flex h-[45dvh] flex-col gap-4 overflow-y-auto pr-1 lg:h-[70dvh]"
        >
          {turns.map((t) =>
            t.speaker === "partner" ? (
              <li key={t.id} className="border-l-4 border-partner pl-4">
                <span className="block text-label font-bold text-partner">
                  {partnerName}
                </span>
                <span className="block text-caption font-medium break-words">
                  {t.text}
                </span>
              </li>
            ) : (
              <li
                key={t.id}
                className="rounded-control bg-surface px-4 py-3 lg:ml-12"
              >
                <span className="block text-label font-bold text-muted">
                  You
                </span>
                <span className="block text-reply break-words">{t.text}</span>
              </li>
            ),
          )}
          {partial && (
            <li className="border-l-4 border-dashed border-partner pl-4">
              <span className="block text-label font-bold text-partner">
                {partnerName}{" "}
                <span className="font-medium text-muted">(still talking)</span>
              </span>
              <span className="block text-caption font-medium break-words">
                {partial}…
              </span>
            </li>
          )}
        </ol>
      )}
    </section>
  );
}
