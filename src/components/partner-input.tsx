"use client";

import { useState } from "react";

export function PartnerInput({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        onSubmit(value);
        setValue("");
      }}
    >
      <label htmlFor="partner-input" className="text-label text-muted">
        What they said
      </label>
      <div className="flex flex-wrap gap-3">
        <input
          id="partner-input"
          name="partner"
          type="text"
          autoComplete="off"
          placeholder="Type what the other person said…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-h-14 min-w-32 flex-1 rounded-control border-2 border-ink/30 bg-surface px-4 text-body text-ink placeholder:text-muted"
        />
        <button
          type="submit"
          className="min-h-14 rounded-control border-2 border-ink/40 bg-surface px-5 text-body font-bold transition-[border-color] duration-150 hover:border-ink"
        >
          Add
        </button>
      </div>
    </form>
  );
}
