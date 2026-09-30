"use client";

import { useEffect, useRef, useState } from "react";
import { PHRASE_MAX } from "@/lib/assist/protocol";
import { noteFields } from "@/lib/profiles/notes";
import type { Note, Phrase } from "@/lib/types";
import { fieldLabel, hint, primaryButton, secondaryButton, textField } from "./ui";

export type PhraseTie = { partnerId?: string; placeId?: string };

interface Props {
  phrases: Phrase[];
  people: Note[];
  places: Note[];
  onAdd: (text: string, tie: PhraseTie) => Promise<boolean>;
  onUpdate: (id: string, text: string, tie: PhraseTie) => Promise<boolean>;
  onRemove: (id: string) => void;
}

const tieValue = (p?: Phrase) => (p?.context.partnerId ? `person:${p.context.partnerId}` : p?.context.placeId ? `place:${p.context.placeId}` : "");
const toTie = (v: string): PhraseTie => (v.startsWith("person:") ? { partnerId: v.slice(7) } : v.startsWith("place:") ? { placeId: v.slice(6) } : {});

function PhraseForm({ phrase, people, places, onSave, onCancel }: { phrase?: Phrase; people: Note[]; places: Note[]; onSave: (text: string, tie: PhraseTie) => Promise<boolean>; onCancel: () => void }) {
  const [text, setText] = useState(phrase?.text ?? "");
  const [tie, setTie] = useState(tieValue(phrase));
  const [taken, setTaken] = useState(false);
  const id = phrase?.id ?? "new";
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        const ok = await onSave(text.trim(), toTie(tie));
        setTaken(!ok);
      }}
    >
      <label htmlFor={`phrase-text-${id}`} className={fieldLabel}>
        Phrase
      </label>
      <input id={`phrase-text-${id}`} className={textField} value={text} maxLength={PHRASE_MAX} autoFocus onChange={(e) => setText(e.target.value)} />
      <label htmlFor={`phrase-for-${id}`} className={fieldLabel}>
        For
      </label>
      <select id={`phrase-for-${id}`} className={textField} value={tie} onChange={(e) => setTie(e.target.value)}>
        <option value="">Anyone</option>
        {people.length > 0 && (
          <optgroup label="People">
            {people.map((n) => (
              <option key={n.id} value={`person:${n.id}`}>
                {noteFields(n).name || n.text}
              </option>
            ))}
          </optgroup>
        )}
        {places.length > 0 && (
          <optgroup label="Places">
            {places.map((n) => (
              <option key={n.id} value={`place:${n.id}`}>
                {noteFields(n).name || n.text}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {taken && (
        <p role="alert" className="text-body font-bold">
          You already have this phrase.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={primaryButton}>
          Save
        </button>
        <button type="button" className={secondaryButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Quick phrases, made here or in the assistant: shown in a conversation's "Your phrases" row. */
export function QuickPhrasesEditor({ phrases, people, places, onAdd, onUpdate, onRemove }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  // The row being deleted (the store write is async, so the row lingers) and where focus goes once it is gone.
  const [removing, setRemoving] = useState<string | null>(null);
  const afterRemove = useRef<{ id: string; focus: string } | null>(null);
  useEffect(() => {
    const pending = afterRemove.current;
    if (pending && !phrases.some((p) => p.id === pending.id)) {
      afterRemove.current = null;
      document.getElementById(pending.focus)?.focus();
    }
  }, [phrases]);
  const confirmDelete = (id: string) => {
    const i = phrases.findIndex((p) => p.id === id);
    const neighbour = phrases[i + 1] ?? phrases[i - 1];
    afterRemove.current = { id, focus: neighbour ? `phrase-edit-${neighbour.id}` : "phrase-add" };
    setRemoving(id);
    onRemove(id);
  };
  const forName = (p: Phrase) => {
    const n = [...people, ...places].find((x) => x.id === (p.context.partnerId ?? p.context.placeId));
    return n ? noteFields(n).name || n.text : "anyone";
  };
  const refocus = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

  return (
    <section aria-labelledby="notes-group-phrases" className="flex flex-col gap-3 border-t-2 border-ink/15 pt-4">
      <h3 id="notes-group-phrases" className="text-reply font-bold">
        Quick phrases
      </h3>
      <p className={hint}>One tap to say these in a conversation. Phrases for a person or place show when you pick them in Talking with or Place.</p>
      {phrases.length > 0 && (
        <ul className="flex flex-col gap-3">
          {phrases.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 rounded-control border-2 border-ink/15 bg-surface px-4 py-3">
              {editing === p.id ? (
                <PhraseForm
                  phrase={p}
                  people={people}
                  places={places}
                  onSave={async (text, tie) => {
                    const ok = await onUpdate(p.id, text, tie);
                    if (ok) {
                      setEditing(null);
                      refocus(`phrase-edit-${p.id}`);
                    }
                    return ok;
                  }}
                  onCancel={() => {
                    setEditing(null);
                    refocus(`phrase-edit-${p.id}`);
                  }}
                />
              ) : confirming === p.id ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-body font-bold">Delete this phrase?</p>
                  <button type="button" className={primaryButton} autoFocus disabled={removing === p.id} onClick={() => confirmDelete(p.id)}>
                    Delete
                  </button>
                  <button type="button" className={secondaryButton} 
                    onClick={() => {
                      setConfirming(null);
                      setRemoving(null);
                      afterRemove.current = null;
                      refocus(`phrase-delete-${p.id}`);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-body break-words">{p.text}</p>
                  <p className="text-label text-muted">For: {forName(p)}</p>
                  <div className="flex flex-wrap gap-3">
                    <button id={`phrase-edit-${p.id}`} type="button" aria-label={`Edit: ${p.text}`} className={secondaryButton} onClick={() => setEditing(p.id)}>
                      Edit
                    </button>
                    <button id={`phrase-delete-${p.id}`} type="button" aria-label={`Delete: ${p.text}`} className={secondaryButton} onClick={() => setConfirming(p.id)}>
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <PhraseForm
          people={people}
          places={places}
          onSave={async (text, tie) => {
            const ok = await onAdd(text, tie);
            if (ok) {
              setAdding(false);
              refocus("phrase-add");
            }
            return ok;
          }}
          onCancel={() => {
            setAdding(false);
            refocus("phrase-add");
          }}
        />
      ) : (
        <div>
          <button id="phrase-add" type="button" className={secondaryButton} onClick={() => setAdding(true)}>
            Add a phrase
          </button>
        </div>
      )}
    </section>
  );
}
