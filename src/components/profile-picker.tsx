import type { Persona } from "@/data/personas";

export function ProfilePicker({ personas, onChoose, onSkip }: { personas: Persona[]; onChoose: (p: Persona) => void; onSkip: () => void }) {
  return (
    <section aria-labelledby="profiles-heading" className="flex max-w-3xl flex-col gap-4">
      <h2 id="profiles-heading" className="text-caption font-bold text-balance">
        Try it with an example profile
      </h2>
      <p className="max-w-[60ch] text-body text-muted">
        Each profile has notes about a person&apos;s life, so the replies can be personal. Notes stay in this browser.
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
      <button type="button" onClick={onSkip} className="min-h-12 self-start text-body font-bold underline underline-offset-4">
        Continue without a profile
      </button>
    </section>
  );
}
