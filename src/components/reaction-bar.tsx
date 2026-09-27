import type { Reaction } from "@/lib/language-packs/types";

export function ReactionBar({ reactions, onReact }: { reactions: Reaction[]; onReact: (text: string) => void }) {
  if (reactions.length === 0) return null;
  return (
    <div role="group" aria-labelledby="reactions-label" className="flex flex-wrap items-center gap-3">
      <span id="reactions-label" className="text-label text-muted">
        Quick reactions
      </span>
      {reactions.map((r, i) => (
        <button
          key={r.id}
          type="button"
          aria-keyshortcuts={`Alt+${i + 1}`}
          onClick={() => onReact(r.text)}
          className="min-h-12 rounded-full border-2 border-ink/15 bg-surface px-5 text-body font-semibold transition-[border-color] duration-150 hover:border-ink/50 active:translate-y-px"
        >
          {r.text}
        </button>
      ))}
    </div>
  );
}
