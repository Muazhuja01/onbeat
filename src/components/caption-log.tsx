"use client";

import { useEffect, useRef } from "react";
import type { Turn } from "@/lib/types";

/** How close to the end of the list still counts as following the newest line. */
const NEAR_END_PX = 64;

export function CaptionLog({ turns, partnerName, partial = "" }: { turns: Turn[]; partnerName: string; partial?: string }) {
  const list = useRef<HTMLOListElement>(null);
  // False once you scroll back to read an earlier line; true again near the end.
  const following = useRef(true);
  const onScroll = () => {
    const el = list.current;
    if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_END_PX;
  };
  useEffect(() => {
    // Scroll only the list, never the page, so the replies and reactions below
    // stay under your finger while captions update (spec 6.3). Instant, never
    // smooth, so reduced motion is respected.
    const el = list.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [turns.length, partial]);

  return (
    <section aria-labelledby="conversation-heading" className="flex min-h-0 flex-col gap-3">
      <h2 id="conversation-heading" className="text-body font-bold">
        Conversation
      </h2>
      {turns.length === 0 && !partial ? (
        <p className="text-body text-muted">What the other person says will appear here in large text.</p>
      ) : (
        <ol ref={list} onScroll={onScroll} className="flex max-h-[45dvh] flex-col gap-4 overflow-y-auto pr-1 lg:max-h-[70dvh]">
          {turns.map((t) =>
            t.speaker === "partner" ? (
              <li key={t.id} className="border-l-4 border-partner pl-4">
                <span className="block text-label font-bold text-partner">{partnerName}</span>
                <span className="block text-caption font-medium break-words">{t.text}</span>
              </li>
            ) : (
              <li key={t.id} className="rounded-control bg-surface px-4 py-3 lg:ml-12">
                <span className="block text-label font-bold text-muted">You</span>
                <span className="block text-reply break-words">{t.text}</span>
              </li>
            ),
          )}
          {partial && (
            <li className="border-l-4 border-dashed border-partner pl-4">
              <span className="block text-label font-bold text-partner">
                {partnerName} <span className="font-medium text-muted">(still talking)</span>
              </span>
              <span className="block text-caption font-medium break-words">{partial}…</span>
            </li>
          )}
        </ol>
      )}
    </section>
  );
}
