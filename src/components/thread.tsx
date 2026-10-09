"use client";

import { ArrowDown, Info, SpeakerHigh, Stop } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Turn } from "@/lib/types";
import { primaryButton, quietButton, secondaryButton } from "./ui";

/** How close to the end of the list still counts as following the newest line. */
const NEAR_END_PX = 64;
/** Room left above their latest line when following stops short of the end to keep it in view. */
const FOLLOW_MARGIN_PX = 12;

interface Props {
  turns: Turn[];
  partnerName: string;
  /** What they have said so far in the turn they are still speaking. */
  partial?: string;
  /** The line being spoken now, and whether it is still waiting for the chosen voice. */
  speaking?: string | null;
  waiting?: boolean;
  /** Notes under your lines, by turn id. */
  lineNotes?: Record<string, string>;
  onStop?: () => void;
  /** Clears the screen for the next conversation; asked about first. */
  onNewConversation?: () => void;
  /** Shown at the bottom on their side, such as "+ They said" on phones. */
  footer?: ReactNode;
}

export function Thread({ turns, partnerName, partial = "", speaking = null, waiting = false, lineNotes = {}, onStop, onNewConversation, footer }: Props) {
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
  // Where following last scrolled to, so that scroll isn't mistaken for you scrolling back.
  const followedTo = useRef<number | null>(null);
  const [behind, setBehind] = useState(false);
  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    const nearEnd = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_END_PX;
    following.current = nearEnd || (followedTo.current !== null && Math.abs(el.scrollTop - followedTo.current) <= 2);
    setBehind(!following.current);
  };
  /**
   * Scrolls to the newest line, but never so far that their latest line goes off the top: what they
   * said matters more than the end of your own line, which the reply tray can stop too.
   * Scrolls only the list, never the page, and instantly, so reduced motion is respected.
   */
  const follow = (el: HTMLOListElement) => {
    const theirs = el.querySelectorAll<HTMLElement>("[data-theirs]");
    const latest = theirs[theirs.length - 1];
    const theirsIsLast = !latest || latest === el.lastElementChild;
    const theirTop = latest ? latest.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - FOLLOW_MARGIN_PX : 0;
    el.scrollTop = theirsIsLast ? el.scrollHeight : Math.min(el.scrollHeight, Math.max(0, theirTop));
    followedTo.current = el.scrollTop;
  };
  // The last line can grow when they carry it on after a pause.
  const lastText = turns.at(-1)?.text;
  useEffect(() => {
    const el = list.current;
    if (el && following.current) follow(el);
  }, [turns.length, lastText, partial]);
  // The list shrinks when a phone keyboard opens: keep the newest line in view.
  useEffect(() => {
    const el = list.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (following.current) follow(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasLines]);
  const toNewest = () => {
    const el = list.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    followedTo.current = el.scrollTop;
    following.current = true;
    setBehind(false);
  };

  // The newest of your lines with the text being spoken.
  const speakingId = speaking === null ? undefined : turns.findLast((t) => t.speaker === "user" && t.text === speaking)?.id;

  return (
    <section aria-labelledby="conversation-heading" className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="conversation-heading" className="text-label font-bold text-muted">
          Conversation
        </h2>
        {onNewConversation && hasLines && !confirming && (
          <button ref={newButton} type="button" className={`${quietButton} min-w-0 [overflow-wrap:anywhere]`} onClick={() => setConfirming(true)}>
            New conversation
          </button>
        )}
      </div>
      {confirming && hasLines && (
        <div className="flex flex-col gap-3">
          <p className="text-body font-bold break-words">Clear this conversation? It isn&apos;t saved anywhere.</p>
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
      {!hasLines ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-2 text-center">
          <p className="text-reply font-bold">Ready when you are</p>
          <p className="max-w-[32rem] text-body text-muted">
            Press <strong className="text-ink">Listen</strong> and their words will show up here in large text. You can also type them with{" "}
            <strong className="text-ink">+ They said</strong>.
          </p>
          {footer}
        </div>
      ) : (
        <div className="relative flex min-h-24 flex-1 flex-col">
          <ol
            ref={list}
            onScroll={onScroll}
            // A tab stop, so keyboard users can scroll back through earlier lines with the arrow keys.
            tabIndex={0}
            aria-label="Conversation lines"
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-1 pb-3"
          >
            {turns.map((t) =>
              t.speaker === "partner" ? (
                <li key={t.id} data-theirs className="max-w-[92%] self-start border-l-4 border-partner pl-4">
                  <span className="block text-label font-bold text-partner">{partnerName}</span>
                  <span className="block text-[1.625rem] leading-[2.0625rem] font-medium [overflow-wrap:anywhere] lg:text-caption">{t.text}</span>
                </li>
              ) : (
                <li key={t.id} className="flex max-w-[80%] flex-col items-end gap-1 self-end lg:max-w-[72%]">
                  <div className="flex max-w-full min-w-0 flex-col gap-1 rounded-[1.25rem] rounded-br-md bg-bubble px-4 py-3 text-on-bubble shadow-lift">
                    <span className="flex flex-wrap items-center gap-2 text-label font-bold">
                      <span className="flex items-center gap-2 opacity-80">
                        {t.id === speakingId && <SpeakerHigh aria-hidden="true" size={16} weight="bold" />}
                        {t.id === speakingId ? (waiting ? "Getting your voice ready…" : "Speaking") : "You"}
                      </span>
                      {t.id === speakingId && onStop && (
                        <button
                          type="button"
                          aria-label="Stop speaking"
                          onClick={onStop}
                          className="ml-auto flex min-h-12 items-center gap-1 rounded-full border-2 border-on-bubble bg-cue px-4 text-label font-bold text-on-cue"
                        >
                          <Stop aria-hidden="true" size={14} weight="fill" />
                          Stop
                        </button>
                      )}
                    </span>
                    <span className="block text-body [overflow-wrap:anywhere]">{t.text}</span>
                  </div>
                  {lineNotes[t.id] && (
                    <p className="flex items-center gap-1 text-label text-muted">
                      <Info aria-hidden="true" size={16} />
                      {lineNotes[t.id]}
                    </p>
                  )}
                </li>
              ),
            )}
            {partial && (
              <li data-theirs className="max-w-[92%] self-start border-l-4 border-dashed border-partner pl-4">
                <span className="block text-label font-bold text-partner">
                  {partnerName} <span className="font-medium text-muted">(still talking)</span>
                </span>
                <span className="block text-[1.625rem] leading-[2.0625rem] font-medium [overflow-wrap:anywhere] lg:text-caption">{partial}…</span>
              </li>
            )}
          </ol>
          {behind && (
            <button
              type="button"
              onClick={toNewest}
              className="absolute bottom-3 left-1/2 flex min-h-12 -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-5 text-label font-bold text-ground opacity-100 shadow-lift transition-opacity duration-150 starting:opacity-0"
            >
              <ArrowDown aria-hidden="true" size={16} weight="bold" />
              Newest
            </button>
          )}
          {footer}
        </div>
      )}
    </section>
  );
}
