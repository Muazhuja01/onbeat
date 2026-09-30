"use client";

import { useId, useState } from "react";
import { hasName, NOTE_MAX, type DraftNote } from "@/lib/profiles/notes";
import type { NoteKind } from "@/lib/types";
import { fieldLabel, hint, primaryButton, secondaryButton, textArea, textField } from "./ui";

export const KIND_LABELS: Record<NoteKind, { group: string; add: string; text: string }> = {
  "about-me": { group: "About you", add: "Add something about you", text: "About you" },
  person: { group: "People", add: "Add a person", text: "Who they are to you" },
  place: { group: "Places", add: "Add a place", text: "A few words about it" },
  routine: { group: "Routines", add: "Add a routine", text: "Routine" },
  preference: { group: "Likes and dislikes", add: "Add a like or dislike", text: "Like or dislike" },
};

const NAME_MAX = 40;

interface Props {
  kind: NoteKind;
  initial?: { name: string; text: string };
  submitLabel: string;
  onSave: (draft: DraftNote) => void;
  onCancel?: () => void;
  /** Prefix for field ids, so two forms on one screen stay apart. */
  idPrefix?: string;
  autoFocus?: boolean;
}

export function NoteForm({ kind, initial, submitLabel, onSave, onCancel, idPrefix, autoFocus }: Props) {
  const generated = useId();
  const id = idPrefix ?? generated;
  const [name, setName] = useState(initial?.name ?? "");
  const [text, setText] = useState(initial?.text ?? "");
  const named = hasName(kind);
  // A person or place note is stored as "Name: description", so the name uses part of the limit.
  const limit = NOTE_MAX - (named && name.trim() ? name.trim().length + 2 : 0);
  const left = limit - text.length;
  const ready = (named ? name.trim() !== "" : text.trim() !== "") && left >= 0;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        onSave(named ? { kind, name: name.trim(), text: text.trim() } : { kind, text: text.trim() });
        if (!initial) {
          setName("");
          setText("");
        }
      }}
    >
      {named && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-name`} className={fieldLabel}>
            Name
          </label>
          <input
            id={`${id}-name`}
            type="text"
            autoComplete="off"
            maxLength={NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus={autoFocus}
            className={textField}
          />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-text`} className={fieldLabel}>
          {KIND_LABELS[kind].text}
        </label>
        <textarea
          id={`${id}-text`}
          rows={2}
          maxLength={Math.max(limit, 0)}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby={`${id}-count`}
          autoFocus={autoFocus && !named}
          className={textArea}
        />
        <p id={`${id}-count`} className={hint}>
          {left >= 0 ? `${left} characters left` : `${-left} characters too long`}
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={!ready} className={primaryButton}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={secondaryButton}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
