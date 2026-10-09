"use client";

import { useEffect, useRef, useState } from "react";
import type { DocumentResult } from "@/lib/profiles/document-client";
import { buildNote, noteFields } from "@/lib/profiles/notes";
import type { Note, NoteKind, Phrase } from "@/lib/types";
import { DocumentImport } from "./document-import";
import { KIND_LABELS, NoteForm } from "./note-form";
import { QuickPhrasesEditor, type PhraseTie } from "./quick-phrases-editor";
import { hint, primaryButton, screenCard, secondaryButton } from "./ui";

const ORDER: NoteKind[] = ["about-me", "person", "place", "routine", "preference"];

interface Props {
  notes: Note[];
  onSave: (note: Note) => void;
  onRemove: (id: string) => void;
  onDone: () => void;
  readDocument?: (file: File) => Promise<DocumentResult>;
  phrases?: Phrase[];
  onAddPhrase?: (text: string, tie: PhraseTie) => Promise<boolean>;
  onUpdatePhrase?: (id: string, text: string, tie: PhraseTie) => Promise<boolean>;
  onRemovePhrase?: (id: string) => void;
}

export function NotesEditor({ notes, onSave, onRemove, onDone, readDocument, phrases, onAddPhrase, onUpdatePhrase, onRemovePhrase }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<NoteKind | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  // Forms and rows come and go; after each change focus goes back to the control that started it.
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => headingRef.current?.focus(), []);
  useEffect(() => {
    if (focus) document.getElementById(focus.id)?.focus();
  }, [focus]);

  const refocus = (id: string) => setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  const addId = (kind: NoteKind) => `notes-add-${kind}`;

  return (
    <section aria-labelledby="notes-heading" className={`${screenCard} flex max-w-3xl flex-col gap-6`}>
      <div className="flex flex-col gap-2">
        <h2 id="notes-heading" ref={headingRef} tabIndex={-1} className="text-caption font-bold text-balance">
          Your notes
        </h2>
        <p className="max-w-[60ch] text-body text-muted">
          Replies are built from these notes. Only the few that fit the moment are sent with each reply. Notes stay in this browser.
        </p>
      </div>

      {ORDER.map((kind) => {
        const group = notes.filter((n) => n.kind === kind).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
        return (
          <section key={kind} aria-labelledby={`notes-group-${kind}`} className="flex flex-col gap-3 border-t-2 border-ink/15 pt-4">
            <h3 id={`notes-group-${kind}`} className="text-reply font-bold">
              {KIND_LABELS[kind].group}
            </h3>
            {group.length > 0 && (
              <ul className="flex flex-col gap-3">
                {group.map((note) => (
                  <li key={note.id} className="flex flex-col gap-2 rounded-control border-2 border-ink/15 bg-surface px-4 py-3">
                    {editing === note.id ? (
                      <NoteForm
                        kind={note.kind}
                        initial={noteFields(note)}
                        submitLabel="Save"
                        autoFocus
                        onSave={(draft) => {
                          onSave(buildNote(draft, { id: note.id, pinned: note.pinned, now: Date.now() }));
                          setEditing(null);
                          refocus(`notes-edit-${note.id}`);
                        }}
                        onCancel={() => {
                          setEditing(null);
                          refocus(`notes-edit-${note.id}`);
                        }}
                      />
                    ) : (
                      <>
                        <p className="text-body break-words">{note.text}</p>
                        {note.pinned && <p className={hint}>Sent with every reply</p>}
                        {confirming === note.id ? (
                          <div className="flex flex-wrap items-center gap-3">
                            <p className="text-body font-bold">Delete this note?</p>
                            <button
                              type="button"
                              className={primaryButton}
                              onClick={() => {
                                setConfirming(null);
                                onRemove(note.id);
                                refocus(addId(kind));
                              }}
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              className={secondaryButton}
                              onClick={() => {
                                setConfirming(null);
                                refocus(`notes-delete-${note.id}`);
                              }}
                            >
                              Keep
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-3">
                            <button
                              id={`notes-edit-${note.id}`}
                              type="button"
                              aria-label={`Edit: ${note.text}`}
                              className={secondaryButton}
                              onClick={() => {
                                setEditing(note.id);
                                setConfirming(null);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              id={`notes-delete-${note.id}`}
                              type="button"
                              aria-label={`Delete: ${note.text}`}
                              className={secondaryButton}
                              onClick={() => setConfirming(note.id)}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {adding === kind ? (
              <NoteForm
                kind={kind}
                submitLabel="Add"
                autoFocus
                onSave={(draft) => {
                  onSave(buildNote(draft, { now: Date.now() }));
                  setAdding(null);
                  refocus(addId(kind));
                }}
                onCancel={() => {
                  setAdding(null);
                  refocus(addId(kind));
                }}
              />
            ) : (
              <button id={addId(kind)} type="button" className={`${secondaryButton} self-start`} onClick={() => setAdding(kind)}>
                {KIND_LABELS[kind].add}
              </button>
            )}
          </section>
        );
      })}

      {phrases && onAddPhrase && onUpdatePhrase && onRemovePhrase && (
        <QuickPhrasesEditor
          phrases={phrases}
          people={notes.filter((n) => n.kind === "person")}
          places={notes.filter((n) => n.kind === "place")}
          onAdd={onAddPhrase}
          onUpdate={onUpdatePhrase}
          onRemove={onRemovePhrase}
        />
      )}

      <section aria-labelledby="notes-document" className="flex flex-col gap-3 border-t-2 border-ink/15 pt-4">
        <h3 id="notes-document" className="text-reply font-bold">
          From a document
        </h3>
        {importing ? (
          <DocumentImport
            readDocument={readDocument}
            onSave={(drafts) => {
              const now = Date.now();
              for (const d of drafts) onSave(buildNote(d, { now }));
              setImporting(false);
              refocus("notes-import");
            }}
            onCancel={() => {
              setImporting(false);
              refocus("notes-import");
            }}
          />
        ) : (
          <button id="notes-import" type="button" className={`${secondaryButton} self-start`} onClick={() => setImporting(true)}>
            Add notes from a document
          </button>
        )}
      </section>

      <button type="button" onClick={onDone} className={`${primaryButton} self-start`}>
        Done
      </button>
    </section>
  );
}
