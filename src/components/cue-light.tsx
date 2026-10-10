import type { SuggestStatus } from "@/lib/conversation/reducer";

const LABELS: Record<SuggestStatus, string> = {
  idle: "Waiting",
  thinking: "Finding replies…",
  ready: "Replies ready",
  paused: "Suggestions paused",
};

/** On phones: short enough, in a fixed width, that the quick reactions fit beside it and never jump rows when it changes. */
const SHORT_LABELS: Record<SuggestStatus, string> = {
  idle: "Waiting",
  thinking: "Finding…",
  ready: "Ready",
  paused: "Paused",
};

/** The cue light: lit amber with an ink border when replies are ready. */
export function CueLight({ status }: { status: SuggestStatus }) {
  const on = status === "ready";
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`inline-block size-6 rounded-full border-2 transition-[background-color,border-color,box-shadow] duration-150 ${
          on ? "border-ink bg-cue shadow-[0_0_0_6px_color-mix(in_srgb,var(--cue)_25%,transparent)]" : "border-muted bg-transparent"
        }`}
      />
      <span className={`text-label max-sm:hidden ${on ? "font-bold text-ink" : "text-muted"}`}>{LABELS[status]}</span>
      <span className={`inline-block min-w-[4.5rem] text-label sm:hidden ${on ? "font-bold text-ink" : "text-muted"}`}>{SHORT_LABELS[status]}</span>
    </span>
  );
}
