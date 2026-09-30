import type { Persona } from "@/data/personas";

/** The example people, reached from "Try a demo". */
export function ProfilePicker({ personas, onChoose, onBack }: { personas: Persona[]; onChoose: (p: Persona) => void; onBack: () => void }) {
  return (
    <section aria-labelledby="profiles-heading" className="flex max-w-3xl flex-col gap-4">
      <h2 id="profiles-heading" className="text-caption font-bold text-balance">
        Try a demo
      </h2>
      <p className="max-w-[60ch] text-body text-muted">
        These example people have notes about their lives, so you can see how replies become personal. Nothing you do in a demo is saved.
      </p>
      <ul className="flex flex-col gap-3">
        {personas.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onChoose(p)}
              className="flex min-h-16 w-full flex-col items-start gap-1 rounded-control border-2 border-ink/15 bg-surface px-4 py-3 text-left transition-[border-color] duration-150 hover:border-ink/50 active:translate-y-px"
            >
              <span className="text-reply font-bold">{p.name}</span>
              <span className="text-body text-muted">{p.summary}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onBack} className="min-h-12 self-start text-body font-bold underline underline-offset-4">
        Back
      </button>
    </section>
  );
}
