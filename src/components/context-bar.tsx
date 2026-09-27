import type { Note } from "@/lib/types";

interface Props {
  places: Note[];
  people: Note[];
  placeId?: string;
  partnerId?: string;
  onChange: (placeId?: string, partnerId?: string) => void;
}

const nameOf = (n: Note) => n.entities[0] ?? n.text;
const selectClass =
  "min-h-12 w-full rounded-control border-2 border-ink/30 bg-surface px-3 text-body text-ink";

export function ContextBar({ places, people, placeId, partnerId, onChange }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-label text-muted">
        Place
        <select className={selectClass} value={placeId ?? ""} onChange={(e) => onChange(e.target.value || undefined, partnerId)}>
          <option value="">Not set</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {nameOf(p)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-label text-muted">
        Talking with
        <select className={selectClass} value={partnerId ?? ""} onChange={(e) => onChange(placeId, e.target.value || undefined)}>
          <option value="">Someone new</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {nameOf(p)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
