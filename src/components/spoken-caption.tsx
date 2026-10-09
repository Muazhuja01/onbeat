"use client";

import { SpeakerHigh } from "@phosphor-icons/react/dist/ssr";
import { useLayoutEffect, useRef } from "react";

/** Text size in rem: the caption size, shrinking in steps for long lines but never below the body size, so it stays easy to read. */
const MAX_REM = 2;
const MIN_REM = 1.25;
const STEP_REM = 0.125;

/**
 * What you said last, in large text. On wide screens the box has a set height (the room left in its column),
 * so a long line gets smaller text instead of pushing the replies and reply box down. Past the smallest size it scrolls.
 */
export function SpokenCaption({ speaking, lastSpoken, waiting = false }: { speaking: string | null; lastSpoken: string | null; waiting?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLParagraphElement>(null);
  const text = speaking ?? lastSpoken;

  useLayoutEffect(() => {
    const el = box.current;
    const p = line.current;
    if (!el || !p) return;
    // Set on the element directly, before paint, so a long line never shows at full size first.
    const fit = () => {
      let size = MAX_REM;
      p.style.fontSize = `${size}rem`;
      while (size > MIN_REM && el.scrollHeight > el.clientHeight) {
        size -= STEP_REM;
        p.style.fontSize = `${size}rem`;
      }
      // Too long even at the smallest size: it scrolls, so keyboard users need to be able to reach it.
      if (el.scrollHeight > el.clientHeight) el.setAttribute("tabindex", "0");
      else el.removeAttribute("tabindex");
    };
    fit();
    el.scrollTop = 0;
    if (typeof ResizeObserver === "undefined") return;
    // Fit again when the window resizes or the font finishes loading.
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    observer.observe(p);
    return () => observer.disconnect();
  }, [text]);

  if (!text)
    return (
      <p className="hidden rounded-control border-2 border-dashed border-ink/15 px-4 py-3 text-body text-muted lg:block lg:flex-1">
        What you say will appear here in large text.
      </p>
    );
  return (
    <section aria-label="What you said" className="flex flex-col rounded-control border-2 border-ink/15 px-4 py-3 lg:min-h-0 lg:flex-1 lg:py-2">
      <p className="flex items-center gap-2 text-label font-bold text-muted">
        <SpeakerHigh aria-hidden="true" size={18} weight="bold" />
        {speaking && waiting ? "Getting your voice ready…" : speaking ? "Speaking" : "Last said"}
      </p>
      <div ref={box} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
        <p ref={line} className="text-[2rem] leading-[1.25] font-semibold break-words">
          {text}
        </p>
      </div>
    </section>
  );
}
