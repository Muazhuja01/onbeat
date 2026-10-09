"use client";

import { MapPin, User } from "@phosphor-icons/react";
import { useState } from "react";
import type { Note } from "@/lib/types";
import { Sheet } from "./sheet";
import { primaryButton } from "./ui";

interface Props {
  places: Note[];
  people: Note[];
  placeId?: string;
  partnerId?: string;
  onChange: (placeId?: string, partnerId?: string) => void;
}

const nameOf = (n: Note) => n.entities[0] ?? n.text;
const chip = "min-h-12 max-w-[16rem] rounded-full border-2 border-edge bg-raised pr-3 pl-10 text-body font-semibold text-ink shadow-lift";
const field = "min-h-12 w-full rounded-control border-2 border-muted bg-raised px-3 text-body text-ink";

function PlaceSelect({ places, placeId, partnerId, onChange, className }: Props & { className: string }) {
  return (
    <select className={className} value={placeId ?? ""} onChange={(e) => onChange(e.target.value || undefined, partnerId)}>
      <option value="">Not set</option>
      {places.map((p) => (
        <option key={p.id} value={p.id}>
          {nameOf(p)}
        </option>
      ))}
    </select>
  );
}

function PersonSelect({ people, placeId, partnerId, onChange, className }: Props & { className: string }) {
  return (
    <select className={className} value={partnerId ?? ""} onChange={(e) => onChange(placeId, e.target.value || undefined)}>
      <option value="">Someone new</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {nameOf(p)}
        </option>
      ))}
    </select>
  );
}

/** Wide screens: the place and the person as two chips in the top bar. */
export function ContextChips(props: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative flex items-center">
        <span className="sr-only">Place</span>
        <MapPin aria-hidden="true" size={20} className="pointer-events-none absolute left-3.5 text-muted" />
        <PlaceSelect {...props} className={chip} />
      </label>
      <label className="relative flex items-center">
        <span className="sr-only">Talking with</span>
        <User aria-hidden="true" size={20} className="pointer-events-none absolute left-3.5 text-muted" />
        <PersonSelect {...props} className={chip} />
      </label>
    </div>
  );
}

/** Phones: one chip naming both, which opens a sheet to change them. */
export function ContextButton(props: Props) {
  const [open, setOpen] = useState(false);
  const place = props.places.find((p) => p.id === props.placeId);
  const person = props.people.find((p) => p.id === props.partnerId);
  const placeName = place ? nameOf(place) : "No place";
  const personName = person ? nameOf(person) : "Someone new";
  return (
    <>
      <button
        type="button"
        aria-label={`Where and who: ${placeName}, ${personName}`}
        onClick={() => setOpen(true)}
        className="flex min-h-12 w-full items-center gap-2 rounded-control border-2 border-edge bg-raised px-4 text-left text-body font-semibold shadow-lift"
      >
        <MapPin aria-hidden="true" size={20} className="shrink-0 text-muted" />
        <span className="truncate">{placeName}</span>
        <span aria-hidden="true" className="text-muted">
          ·
        </span>
        <User aria-hidden="true" size={20} className="shrink-0 text-muted" />
        <span className="truncate">{personName}</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Where and who" closeLabel="Close where and who">
        <label className="flex flex-col gap-1 text-label text-muted">
          Place
          <PlaceSelect {...props} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-label text-muted">
          Talking with
          <PersonSelect {...props} className={field} />
        </label>
        <button type="button" onClick={() => setOpen(false)} className={primaryButton}>
          Done
        </button>
      </Sheet>
    </>
  );
}

/** Still used by the conversation screen until it is rebuilt from the new pieces. */
export const ContextBar = ContextChips;
