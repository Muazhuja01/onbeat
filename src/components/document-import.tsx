"use client";

import { useId, useState } from "react";
import { DOCUMENT_ACCEPT, notesFromDocument, type DocumentResult } from "@/lib/profiles/document-client";
import type { DraftNote } from "@/lib/profiles/notes";
import { fieldLabel, hint, primaryButton, secondaryButton } from "./ui";

interface Props {
  onSave: (drafts: DraftNote[]) => void;
  onCancel: () => void;
  readDocument?: (file: File) => Promise<DocumentResult>;
}

export const draftLabel = (d: DraftNote) => (d.name && !d.text.toLowerCase().includes(d.name.toLowerCase()) ? `${d.name}: ${d.text}` : d.text);

export function DocumentImport({ onSave, onCancel, readDocument = notesFromDocument }: Props) {
  const id = useId();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ drafts: DraftNote[]; kept: boolean[]; truncated: boolean } | null>(null);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setError(null);
    const result = await readDocument(file);
    setReading(false);
    if (result.ok) setReview({ drafts: result.notes, kept: result.notes.map(() => true), truncated: result.truncated });
    else setError(result.message);
  };

  if (review) {
    const count = review.kept.filter(Boolean).length;
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-reply font-bold">Check these notes</h3>
        <p className={hint}>Untick any you don&apos;t want. You can edit them after saving.</p>
        {review.truncated && <p className="text-body">The document was long, so only the first part was used.</p>}
        <ul className="flex flex-col gap-1">
          {review.drafts.map((d, i) => (
            <li key={i}>
              <label className="flex min-h-12 cursor-pointer items-start gap-3 py-2 text-body">
                <input
                  type="checkbox"
                  checked={review.kept[i]}
                  onChange={(e) => setReview({ ...review, kept: review.kept.map((k, j) => (j === i ? e.target.checked : k)) })}
                  className="mt-1 size-6 shrink-0 accent-ink"
                />
                {draftLabel(d)}
              </label>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={count === 0} onClick={() => onSave(review.drafts.filter((_, i) => review.kept[i]))} className={primaryButton}>
            Save {count} {count === 1 ? "note" : "notes"}
          </button>
          <button type="button" onClick={onCancel} className={secondaryButton}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[60ch] text-body">
        To write notes from a document, its text is sent to the AI service OnBeat uses. OnBeat doesn&apos;t keep a copy. Replies only ever send the
        few notes that fit the moment.
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-file`} className={fieldLabel}>
          Choose a document (text, Word or PDF, up to 4 MB)
        </label>
        <input
          id={`${id}-file`}
          type="file"
          accept={DOCUMENT_ACCEPT}
          disabled={reading}
          onChange={(e) => {
            void choose(e.target.files?.[0]);
            // Clearing lets the same file be chosen again after an error.
            e.target.value = "";
          }}
          className="min-h-12 max-w-full text-body file:mr-3 file:min-h-12 file:rounded-control file:border-2 file:border-ink/40 file:bg-surface file:px-4 file:font-bold file:text-ink"
        />
      </div>
      <div role="status" className="text-body">
        {reading ? "Reading your document…" : error}
      </div>
      <button type="button" onClick={onCancel} className={`${secondaryButton} self-start`}>
        Cancel
      </button>
    </div>
  );
}
