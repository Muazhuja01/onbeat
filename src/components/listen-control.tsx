"use client";

import { Microphone, MicrophoneSlash } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { Hearing, HearingStatus } from "@/lib/hearing/engine";

const TEXT: Record<HearingStatus, string> = {
  off: "Turn this on to see their words as captions. The first time, it downloads speech recognition to this device.",
  loading: "Getting speech recognition ready…",
  listening: "Listening. Their words appear in the conversation.",
  denied: "Microphone is off. You can still type replies. Turn it on in your browser's site settings.",
  unavailable: "This browser can't use the microphone here. You can still type what they said.",
  error: "Speech recognition couldn't load or stopped working. Check your connection, then press Listen to try again.",
  interrupted: "The microphone stopped. Check that it's connected, then press Listen to try again.",
};

interface Props {
  hearing: Hearing | null;
  status: HearingStatus;
  progress: number;
  onToggle: () => void;
}

/** States where the sentence tells the user what went wrong and what to do; only these show on screen. */
const PROBLEMS = new Set<HearingStatus>(["denied", "unavailable", "error", "interrupted"]);

export function ListenControl({ hearing, status, progress, onToggle }: Props) {
  const on = status === "listening" || status === "loading";
  return (
    <div className="relative">
      <button
        type="button"
        aria-pressed={on}
        onClick={onToggle}
        className={`inline-flex min-h-12 items-center gap-2 rounded-full border-2 px-5 text-body font-bold transition-[border-color,background-color] duration-150 ${
          status === "listening" ? "border-transparent bg-cue text-on-cue" : "border-edge bg-raised text-ink shadow-lift hover:border-ink"
        }`}
      >
        {on ? <Microphone aria-hidden="true" size={22} weight="bold" /> : <MicrophoneSlash aria-hidden="true" size={22} />}
        Listen
        {/* Hidden from screen readers: the percentage would be read out on every change, and the name stays "Listen". */}
        {status === "loading" && (
          <span aria-hidden="true" className="tabular-nums font-medium text-muted">
            {Math.max(0, Math.min(100, progress))}%
          </span>
        )}
        {status === "listening" && <LevelMeter hearing={hearing} />}
      </button>
      {/* Always read out; on screen only when something went wrong. */}
      <p
        className={
          PROBLEMS.has(status)
            ? "absolute top-full left-0 z-10 mt-2 w-max max-w-[min(22rem,calc(100vw-2rem))] rounded-control border-2 border-edge bg-surface p-3 text-label shadow-tray"
            : "sr-only"
        }
      >
        <span role="status">{TEXT[status]}</span>
      </p>
    </div>
  );
}

/** How loud the microphone is right now. Subscribes itself so level updates don't re-render the screen. */
function LevelMeter({ hearing }: { hearing: Hearing | null }) {
  const [level, setLevel] = useState(0);
  useEffect(() => (hearing ? hearing.on("level", setLevel) : undefined), [hearing]);
  return (
    <span aria-hidden="true" className="block h-3 w-12 overflow-hidden rounded-full border-2 border-on-cue/50">
      <span className="block h-full bg-on-cue transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%` }} />
    </span>
  );
}
