"use client";

import { useEffect, useRef, useState } from "react";
import type { PendingSuggestion, SourceLine } from "@/lib/learning/types";
import { composeNoteText, type DraftNote } from "@/lib/profiles/notes";
import type { Note } from "@/lib/types";
import { KIND_LABELS, NoteForm } from "./note-form";
import { primaryButton, secondaryButton } from "./ui";

interface Props {
  suggestions: PendingSuggestion[];
  /** The profile's notes now, so an edit is compared with what is really there. */
  notes: Note[];
  onKeep: (suggestion: PendingSuggestion, draft: DraftNote) => void;
  onSkip: (id: string) => void;
  onSkipAll: () => void;
  onDone: () => void;
  now?: Date;
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "today 3:12 pm", "yesterday 9:00 am", or the weekday and date. */
export function whenSaid(at: number, now: Date): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay(d, now)) return `today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `yesterday ${time}`;
  return `${d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })} ${time}`;
}

function Source({ line, now }: { line: SourceLine; now: Date }) {
  const who = line.speaker === "user" ? "You" : (line.partnerName ?? "The other person");
  return (
    <p className="text-label text-muted break-words">
      {who} said: &ldquo;{line.text}&rdquo;, {whenSaid(line.at, now)}
    </p>
  );
}

export function SuggestedNotes({ suggestions, notes, onKeep, onSkip, onSkipAll, onDone, now = new Date() }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => headingRef.current?.focus(), []);
  // The card that had focus goes away; the heading is the next sensible place.
  const settle = () => headingRef.current?.focus();

  return (
    <section aria-labelledby="suggestions-heading" className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 id="suggestions-heading" ref={headingRef} tabIndex={-1} className="text-caption font-bold text-balance">
          Suggested notes
        </h2>
        <p className="max-w-[60ch] text-body text-muted">OnBeat noticed these in your conversations. Nothing is saved until you choose Keep.</p>
      </div>

      {suggestions.length === 0 ? (
        <p className="text-body">Nothing to review. OnBeat suggests notes from your conversations; you choose what to keep.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {suggestions.map((s) => {
            const target = s.noteId ? notes.find((n) => n.id === s.noteId) : undefined;
            const text = composeNoteText(s.draft);
            const group = KIND_LABELS[s.draft.kind].group;
            return (
              <li key={s.id} className="flex flex-col gap-3 rounded-control border-2 border-ink/15 bg-surface px-4 py-3">
                <h3 className="text-reply font-bold">{target ? `Change a note: ${group}` : `New note: ${group}`}</h3>
                {target ? (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
                    <dt className="font-bold">Now</dt>
                    <dd className="break-words">{target.text}</dd>
                    <dt className="font-bold">New</dt>
                    <dd className="break-words">{text}</dd>
                  </dl>
                ) : (
                  <p className="text-body break-words">{text}</p>
                )}
                <div className="flex flex-col gap-1">
                  {s.sources.map((line, i) => (
                    <Source key={i} line={line} now={now} />
                  ))}
                </div>
                {editing === s.id ? (
                  <NoteForm
                    kind={s.draft.kind}
                    initial={{ name: s.draft.name ?? "", text: s.draft.text }}
                    submitLabel="Keep"
                    autoFocus
                    onSave={(draft) => {
                      setEditing(null);
                      onKeep(s, draft);
                      settle();
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      aria-label={`Keep: ${text}`}
                      className={primaryButton}
                      onClick={() => {
                        onKeep(s, s.draft);
                        settle();
                      }}
                    >
                      Keep
                    </button>
                    <button type="button" aria-label={`Edit: ${text}`} className={secondaryButton} onClick={() => setEditing(s.id)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`Skip: ${text}`}
                      className={secondaryButton}
                      onClick={() => {
                        onSkip(s.id);
                        settle();
                      }}
                    >
                      Skip
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {suggestions.length > 1 &&
          (confirmingAll ? (
            <>
              <p className="text-body font-bold">Skip all {suggestions.length} suggestions?</p>
              <button
                type="button"
                className={primaryButton}
                onClick={() => {
                  setConfirmingAll(false);
                  onSkipAll();
                  settle();
                }}
              >
                Skip all
              </button>
              <button type="button" className={secondaryButton} onClick={() => setConfirmingAll(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className={secondaryButton} onClick={() => setConfirmingAll(true)}>
              Skip all
            </button>
          ))}
        <button type="button" onClick={onDone} className={primaryButton}>
          Done
        </button>
      </div>
    </section>
  );
}
