"use client";

import { useEffect, useRef, useState } from "react";
import type { PendingSuggestion, SourceLine } from "@/lib/learning/types";
import { composeNoteText, type DraftNote } from "@/lib/profiles/notes";
import type { Note } from "@/lib/types";
import { KIND_LABELS, NoteForm } from "./note-form";
import { primaryButton, screenCard, secondaryButton } from "./ui";
import { SuggestionCard } from "./suggestion-card";

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

export function SuggestedNotes({ suggestions: all, notes, onKeep, onSkip, onSkipAll, onDone, now = new Date() }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  // A card goes as soon as it is kept or skipped, before saving finishes, so a second tap
  // (common with tremor) can't keep the same note twice.
  const [handled, setHandled] = useState<ReadonlySet<string>>(() => new Set());
  // Read only in event handlers: a second tap can arrive before React re-renders.
  const handling = useRef(new Set<string>());
  const suggestions = all.filter((s) => !handled.has(s.id));
  const handle = (id: string, action: () => void) => {
    if (handling.current.has(id)) return;
    handling.current.add(id);
    setHandled((prev) => new Set(prev).add(id));
    action();
  };
  const [confirmingAll, setConfirmingAll] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => headingRef.current?.focus(), []);
  // The card that had focus goes away; the heading is the next sensible place.
  const settle = () => headingRef.current?.focus();

  return (
    <section aria-labelledby="suggestions-heading" className={`${screenCard} flex max-w-3xl flex-col gap-6`}>
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
              <SuggestionCard
                key={s.id}
                heading={target ? `Change a note: ${group}` : `New note: ${group}`}
                current={target?.text}
                text={text}
                sources={s.sources.map((line, i) => (
                  <Source key={i} line={line} now={now} />
                ))}
                editing={editing === s.id}
                editForm={
                  <NoteForm
                    kind={s.draft.kind}
                    initial={{ name: s.draft.name ?? "", text: s.draft.text }}
                    submitLabel="Keep"
                    autoFocus
                    onSave={(draft) => {
                      setEditing(null);
                      handle(s.id, () => onKeep(s, draft));
                      settle();
                    }}
                    onCancel={() => setEditing(null)}
                  />
                }
                onKeep={() => {
                  handle(s.id, () => onKeep(s, s.draft));
                  settle();
                }}
                onEdit={() => setEditing(s.id)}
                onSkip={() => {
                  handle(s.id, () => onSkip(s.id));
                  settle();
                }}
              />
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
