import type { Reaction } from "@/lib/language-packs/types";

/**
 * `reserve`: keep the row's height while there are no reactions, so what's below doesn't move.
 * On phones the chips are smaller, so a common pair fits on the cue light's row instead of a row of its own.
 */
export function ReactionBar({ reactions, onReact, reserve = false }: { reactions: Reaction[]; onReact: (text: string) => void; reserve?: boolean }) {
  if (reactions.length === 0) return reserve ? <div aria-hidden="true" className="tray-extras min-h-12 max-sm:min-h-10" /> : null;
  return (
    <div role="group" aria-labelledby="reactions-label" className="tray-extras flex flex-wrap items-center gap-3 max-sm:gap-2">
      <span id="reactions-label" className="sr-only">
        Quick reactions
      </span>
      {reactions.map((r, i) => (
        <button
          key={r.id}
          type="button"
          aria-keyshortcuts={`Alt+${i + 1}`}
          onClick={() => onReact(r.text)}
          className="min-h-12 rounded-full border-2 border-edge bg-raised shadow-lift px-5 text-body font-semibold max-sm:min-h-10 max-sm:px-3.5 max-sm:text-label transition-[border-color] duration-150 hover:border-ink/50 active:translate-y-px"
        >
          {r.text}
        </button>
      ))}
    </div>
  );
}
