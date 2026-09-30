"use client";

import { useEffect, useRef, useState } from "react";
import type { DocumentResult } from "@/lib/profiles/document-client";
import { NOTE_MAX, setupNotes, type DraftNote } from "@/lib/profiles/notes";
import { cleanName, NAME_MAX } from "@/lib/profiles/registry";
import type { Note } from "@/lib/types";
import { DocumentImport, draftLabel } from "./document-import";
import { NoteForm } from "./note-form";
import { fieldLabel, hint, linkButton, primaryButton, secondaryButton, textArea, textField } from "./ui";

interface Props {
  onDone: (name: string, notes: Note[]) => void | Promise<void>;
  /** Shown on the first step when there is a demo to try. */
  onDemo?: () => void;
  /** Given when there is a profile or demo to go back to. */
  onCancel?: () => void;
  /** Restoring an export, e.g. on a new device. Shown on the first step. */
  onImport?: (file: File) => void;
  readDocument?: (file: File) => Promise<DocumentResult>;
}

const HEADINGS = ["Set up OnBeat", "Tell OnBeat about you", "Who do you talk to, and where?"];

function AddedList({ items, onRemove }: { items: DraftNote[]; onRemove: (i: number) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((d, i) => (
        <li key={i} className="flex flex-wrap items-center justify-between gap-3 rounded-control border-2 border-ink/15 bg-surface px-4 py-2">
          <span className="text-body break-words">{draftLabel(d)}</span>
          <button type="button" aria-label={`Remove ${draftLabel(d)}`} onClick={() => onRemove(i)} className={secondaryButton}>
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ProfileSetup({ onDone, onDemo, onCancel, onImport, readDocument }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [docDrafts, setDocDrafts] = useState<DraftNote[]>([]);
  const [importing, setImporting] = useState(false);
  const [people, setPeople] = useState<DraftNote[]>([]);
  const [places, setPlaces] = useState<DraftNote[]>([]);
  // A second tap while saving would make a second profile.
  const [finishing, setFinishing] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  // The first step is the page's start, so focus stays put on load; after that each step's heading takes focus.
  useEffect(() => {
    if (moved.current) headingRef.current?.focus();
    moved.current = true;
  }, [step]);

  const clean = cleanName(name);
  // Setup starts the main note with "I'm <name>. " when the text doesn't say the name.
  const aboutLimit = NOTE_MAX - clean.length - 6;
  const cancel = onCancel && (
    <button type="button" onClick={onCancel} className={secondaryButton}>
      Cancel
    </button>
  );

  return (
    <section aria-labelledby="setup-heading" className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className={hint}>Step {step + 1} of 3</p>
        <h2 id="setup-heading" ref={headingRef} tabIndex={-1} className="text-caption font-bold text-balance">
          {HEADINGS[step]}
        </h2>
      </div>

      {step === 0 && (
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (clean) setStep(1);
          }}
        >
          <p className="max-w-[60ch] text-body text-muted">
            OnBeat suggests replies from what it knows about you. This takes a minute, and you can change everything later. It all stays in
            this browser.
          </p>
          <div className="flex flex-col gap-1">
            <label htmlFor="setup-name" className={fieldLabel}>
              What&apos;s your name?
            </label>
            <input
              id="setup-name"
              type="text"
              autoComplete="given-name"
              maxLength={NAME_MAX}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`${textField} max-w-md`}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={!clean} className={primaryButton}>
              Next
            </button>
            {cancel}
          </div>
          {onDemo && (
            <button type="button" onClick={onDemo} className={linkButton}>
              Try a demo first
            </button>
          )}
          {onImport && (
            <div className="flex flex-col gap-1">
              <label htmlFor="setup-import" className={fieldLabel}>
                Have an OnBeat export? Import it
              </label>
              <input
                id="setup-import"
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) onImport(file);
                }}
                className="min-h-12 max-w-full text-label file:mr-3 file:min-h-12 file:rounded-control file:border-2 file:border-ink/40 file:bg-surface file:px-4 file:font-bold file:text-ink"
              />
            </div>
          )}
        </form>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <label htmlFor="setup-about" className={fieldLabel}>
              About you
            </label>
            <p id="setup-about-hint" className={hint}>
              How you communicate and anything people should know. For example: I have ALS, so I type to talk. I can hear fine. Please give me
              time to answer.
            </p>
            <textarea
              id="setup-about"
              rows={4}
              maxLength={aboutLimit}
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              aria-describedby="setup-about-hint setup-about-count"
              className={textArea}
            />
            <p id="setup-about-count" className={hint}>
              {aboutLimit - about.length} characters left
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-reply font-bold">Or start from a document</h3>
            {docDrafts.length > 0 ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-body">
                  {docDrafts.length} {docDrafts.length === 1 ? "note" : "notes"} from your document will be added.
                </p>
                <button type="button" onClick={() => setDocDrafts([])} className={secondaryButton}>
                  Remove them
                </button>
              </div>
            ) : importing ? (
              <DocumentImport
                readDocument={readDocument}
                onSave={(drafts) => {
                  setDocDrafts(drafts);
                  setImporting(false);
                }}
                onCancel={() => setImporting(false)}
              />
            ) : (
              <>
                <p className={hint}>A care plan, an &quot;about me&quot; page or a letter. OnBeat suggests notes from it and you choose which to keep.</p>
                <button type="button" onClick={() => setImporting(true)} className={`${secondaryButton} self-start`}>
                  Start from a document
                </button>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => setStep(0)} className={secondaryButton}>
              Back
            </button>
            <button type="button" onClick={() => setStep(2)} className={primaryButton}>
              Next
            </button>
            {cancel}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-6">
          <p className="max-w-[60ch] text-body text-muted">
            Add a few people and places. They&apos;ll appear in the Talking with and Place lists, so replies can fit who you&apos;re with. You
            can skip this.
          </p>
          <div className="flex flex-col gap-3">
            <h3 className="text-reply font-bold">People</h3>
            <AddedList items={people} onRemove={(i) => setPeople(people.filter((_, j) => j !== i))} />
            <NoteForm kind="person" idPrefix="person" submitLabel="Add person" onSave={(d) => setPeople([...people, d])} />
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="text-reply font-bold">Places</h3>
            <AddedList items={places} onRemove={(i) => setPlaces(places.filter((_, j) => j !== i))} />
            <NoteForm kind="place" idPrefix="place" submitLabel="Add place" onSave={(d) => setPlaces([...places, d])} />
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => setStep(1)} className={secondaryButton}>
              Back
            </button>
            <button
              type="button"
              disabled={finishing}
              onClick={async () => {
                setFinishing(true);
                try {
                  await onDone(clean, setupNotes({ name: clean, about, drafts: [...docDrafts, ...people, ...places] }, Date.now()));
                } finally {
                  setFinishing(false);
                }
              }}
              className={primaryButton}
            >
              Finish
            </button>
            {cancel}
          </div>
        </div>
      )}
    </section>
  );
}
