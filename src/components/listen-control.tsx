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
  error: "Couldn't download speech recognition. Check your connection and try again.",
};

interface Props {
  hearing: Hearing | null;
  status: HearingStatus;
  progress: number;
  onToggle: () => void;
}

export function ListenControl({ hearing, status, progress, onToggle }: Props) {
  const on = status === "listening" || status === "loading";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-pressed={on}
          onClick={onToggle}
          className={`inline-flex min-h-12 items-center gap-2 rounded-control border-2 px-5 text-body font-bold transition-[border-color,background-color] duration-150 ${
            on ? "border-ink bg-cue text-on-cue" : "border-ink/30 bg-surface text-ink hover:border-ink"
          }`}
        >
          {on ? <Microphone aria-hidden="true" size={24} weight="bold" /> : <MicrophoneSlash aria-hidden="true" size={24} />}
          Listen
        </button>
        {status === "listening" && <LevelMeter hearing={hearing} />}
      </div>
      <p className="text-label text-muted">
        {/* Only the status sentence is live; the percentage would be read out on every change. */}
        <span role="status">{TEXT[status]}</span>
        {status === "loading" && <span className="tabular-nums"> {Math.max(0, Math.min(100, progress))}%</span>}
      </p>
    </div>
  );
}

/** How loud the microphone is right now. Subscribes itself so level updates don't re-render the screen. */
function LevelMeter({ hearing }: { hearing: Hearing | null }) {
  const [level, setLevel] = useState(0);
  useEffect(() => (hearing ? hearing.on("level", setLevel) : undefined), [hearing]);
  return (
    <span aria-hidden="true" className="block h-3 w-24 overflow-hidden rounded-full border-2 border-ink/30">
      <span className="block h-full bg-partner transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%` }} />
    </span>
  );
}
