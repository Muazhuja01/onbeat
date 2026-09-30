"use client";

import type { ReactNode } from "react";
import { primaryButton, secondaryButton } from "./ui";

export interface SuggestionCardProps {
  id?: string;
  heading: string;
  current?: string;
  text: string;
  sources: ReactNode;
  notice?: string;
  editForm?: ReactNode;
  editing: boolean;
  keepLabel?: string;
  canKeep?: boolean;
  canEdit?: boolean;
  onKeep: () => void;
  onEdit: () => void;
  onSkip: () => void;
}

/** One proposed change: what it is, where it came from, and Keep, Edit, Skip. */
export function SuggestionCard({ id, heading, current, text, sources, notice, editForm, editing, keepLabel = "Keep", canKeep = true, canEdit = true, onKeep, onEdit, onSkip }: SuggestionCardProps) {
  return (
    <li id={id} className="flex flex-col gap-3 rounded-control border-2 border-ink/15 bg-surface px-4 py-3">
      <h3 className="text-reply font-bold">{heading}</h3>
      {current !== undefined ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
          <dt className="font-bold">Now</dt>
          <dd className="break-words">{current}</dd>
          <dt className="font-bold">New</dt>
          <dd className="break-words">{text}</dd>
        </dl>
      ) : (
        <p className="text-body break-words">{text}</p>
      )}
      {sources && <div className="flex flex-col gap-1">{sources}</div>}
      {notice && <p className="text-body font-bold">{notice}</p>}
      {editing && editForm ? (
        editForm
      ) : (
        <div className="flex flex-wrap gap-3">
          {canKeep && (
            <button type="button" aria-label={`${keepLabel}: ${text}`} className={primaryButton} onClick={onKeep}>
              {keepLabel}
            </button>
          )}
          {canEdit && (
            <button type="button" aria-label={`Edit: ${text}`} className={secondaryButton} onClick={onEdit}>
              Edit
            </button>
          )}
          <button type="button" aria-label={`Skip: ${text}`} className={secondaryButton} onClick={onSkip}>
            Skip
          </button>
        </div>
      )}
    </li>
  );
}
