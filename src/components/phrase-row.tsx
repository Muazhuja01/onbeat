import type { Phrase } from "@/lib/types";

/** Quick phrases for who the user is talking with or where, one tap to say. */
export function PhraseRow({ phrases, onSpeak }: { phrases: Phrase[]; onSpeak: (text: string) => void }) {
  if (phrases.length === 0) return null;
  return (
    <div role="group" aria-labelledby="phrases-label" className="tray-extras flex flex-wrap items-center gap-3">
      <span id="phrases-label" className="text-label text-muted">
        Your phrases
      </span>
      {phrases.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSpeak(p.text)}
          className="min-h-12 rounded-full border-2 border-edge bg-raised shadow-lift px-5 text-left text-body font-semibold transition-[border-color] duration-150 hover:border-ink/50 active:translate-y-px"
        >
          {p.text}
        </button>
      ))}
    </div>
  );
}
