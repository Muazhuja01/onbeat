import type { SuggestStatus } from "@/lib/conversation/reducer";

const LABELS: Record<SuggestStatus, string> = {
  idle: "Waiting",
  thinking: "Finding replies…",
  ready: "Replies ready",
  paused: "Suggestions paused",
};

/** The cue light: lit amber with an ink border when replies are ready. */
export function CueLight({ status }: { status: SuggestStatus }) {
  const on = status === "ready";
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`inline-block size-7 rounded-full border-2 transition-[background-color,border-color] duration-150 ${
          on ? "border-ink bg-cue" : "border-muted bg-transparent"
        }`}
      />
      <span className={`text-label ${on ? "font-bold text-ink" : "text-muted"}`}>{LABELS[status]}</span>
    </span>
  );
}
