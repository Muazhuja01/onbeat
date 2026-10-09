"use client";

import { useLayoutEffect, useRef } from "react";
import type { VoiceMode } from "@/lib/voice/engine";
import type { VoiceSource } from "@/lib/voice/messages";

export function voiceStatusText(mode: VoiceMode, source: VoiceSource, progress: number): string {
  if (source === "awake") return "Your voice is ready.";
  if (mode === "basic") return "Using the basic voice.";
  if (source === "down")
    return mode === "natural" ? "Using the backup voice." : `Getting the backup voice ready… ${Math.max(0, Math.min(100, progress))}%. The basic voice works in the meantime.`;
  return "Waking your voice…";
}

interface Props {
  mode: VoiceMode;
  source: VoiceSource;
  progress: number;
  /**
   * While a conversation is on screen, the line keeps the tallest height it has had, even once it
   * has nothing to say: it sits at the bottom of the tray, so a change in its height would move the replies.
   */
  reserve?: boolean;
}

export function VoiceStatus({ mode, source, progress, reserve = false }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLParagraphElement>(null);
  const tallest = useRef(0);
  // Set on the element, not through state, so the height is held before the browser paints.
  useLayoutEffect(() => {
    if (!reserve) tallest.current = 0;
    else if (line.current) tallest.current = Math.max(tallest.current, line.current.offsetHeight);
    if (box.current) box.current.style.minHeight = tallest.current ? `${tallest.current}px` : "";
  });

  // Nothing to say when your own voice is ready.
  const text = source === "awake" ? null : voiceStatusText(mode, source, progress);
  if (text === null && !reserve) return null;
  return (
    <div ref={box}>
      {text !== null && (
        <p ref={line} className="text-label text-muted">
          {text}
        </p>
      )}
    </div>
  );
}
