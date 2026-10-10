"use client";

import { Plus } from "@phosphor-icons/react";
import { useState } from "react";

/** Opens the box for typing what the other person said. `compact` is a square + button, so the type box keeps its width on phones. */
export function TheySaidButton({ onOpen, compact = false }: { onOpen: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      // Focus stays in "Type a reply" until the click lands: on phones, leaving it brings the reactions back
      // and moves this button between mouse down and up.
      onMouseDown={(e) => e.preventDefault()}
      className={`flex min-h-14 shrink-0 items-center gap-2 rounded-control border-2 border-edge bg-raised text-label font-bold text-muted transition-[border-color] duration-150 hover:border-ink ${
        compact ? "w-14 justify-center" : "px-4"
      }`}
    >
      <Plus aria-hidden="true" size={compact ? 22 : 18} weight="bold" />
      <span className={compact ? "sr-only" : undefined}>They said</span>
    </button>
  );
}

/**
 * One line for what the other person said. It has the same shape as the type row (a label above
 * one row), so opening it doesn't move the replies. Enter adds the line; Escape or Cancel closes it.
 */
export function TheySaidForm({ onSubmit, onClose }: { onSubmit: (text: string) => void; onClose: () => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex flex-col gap-2 border-l-4 border-partner pl-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        onSubmit(value);
        onClose();
      }}
      onKeyDown={(e) => {
        // Handled here, so the screen's own Escape (stop speaking, clear the reply box) doesn't run too.
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
    >
      <label htmlFor="partner-input" className="text-label font-bold text-partner">
        What they said
      </label>
      <div className="flex flex-wrap gap-3">
        <input
          id="partner-input"
          name="partner"
          type="text"
          autoComplete="off"
          autoFocus
          placeholder="Type what the other person said…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-h-14 min-w-0 flex-1 basis-0 rounded-control border-2 border-muted bg-raised px-4 text-body text-ink placeholder:text-muted"
        />
        <button type="submit" className="min-h-14 rounded-control border-2 border-partner bg-partner px-5 text-body font-bold text-ground">
          Add
        </button>
        <button type="button" onClick={onClose} className="min-h-14 rounded-control border-2 border-edge bg-raised px-5 text-body font-bold">
          Cancel
        </button>
      </div>
    </form>
  );
}
