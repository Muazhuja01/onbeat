import { SpeakerHigh } from "@phosphor-icons/react/dist/ssr";

export function SpokenCaption({ speaking, lastSpoken, waiting = false }: { speaking: string | null; lastSpoken: string | null; waiting?: boolean }) {
  if (!lastSpoken) return null;
  return (
    <section aria-label="What you said" className="rounded-control border-2 border-ink/15 px-4 py-3">
      <p className="flex items-center gap-2 text-label font-bold text-muted">
        <SpeakerHigh aria-hidden="true" size={18} weight="bold" />
        {speaking && waiting ? "Getting your voice ready…" : speaking ? "Speaking" : "Last said"}
      </p>
      <p className="text-caption font-semibold break-words">{speaking ?? lastSpoken}</p>
    </section>
  );
}
