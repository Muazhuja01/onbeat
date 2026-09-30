"use client";

import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ASSIST_USER_MAX, PHRASE_MAX, type AssistJob } from "@/lib/assist/protocol";
import { AssistSession, JOB_TEXT, type AssistCard, type KeepOutcome } from "@/lib/assist/session";
import type { MemoryStore } from "@/lib/memory/store";
import { composeNoteText, type DraftNote } from "@/lib/profiles/notes";
import { KIND_LABELS, NoteForm } from "./note-form";
import { SuggestionCard } from "./suggestion-card";
import { fieldLabel, hint, primaryButton, secondaryButton, textArea, textField } from "./ui";

interface Props {
  memory: MemoryStore;
  onChanged: () => void;
  onClose: () => void;
  announce: (text: string) => void;
  session?: AssistSession;
}

const JOBS: AssistJob[] = ["update", "prepare", "phrases"];
const NOTICE = "The assistant sends your notes and quick phrases to the AI service OnBeat uses, more than a reply does. OnBeat doesn't keep them.";

function PhraseForm({ initial, onSave, onCancel }: { initial: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSave(text.trim());
      }}
    >
      <label className={fieldLabel} htmlFor="assist-phrase-edit">
        Phrase
      </label>
      <input id="assist-phrase-edit" className={textField} value={text} maxLength={PHRASE_MAX} autoFocus onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={primaryButton}>
          Keep
        </button>
        <button type="button" className={secondaryButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function AssistantScreen({ memory, onChanged, onClose, announce, session: given }: Props) {
  const [session] = useState(() => given ?? new AssistSession({ memory }));
  const state = useSyncExternalStore(
    (fn) => session.onChange(fn),
    () => session.state,
    () => session.state,
  );
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const seen = useRef(0);

  useEffect(() => {
    // Closing is permanent, and StrictMode unmounts and remounts straight away in development.
    // So close on a timer that a remount cancels; a real unmount lets it run.
    if (closing.current) clearTimeout(closing.current);
    closing.current = null;
    headingRef.current?.focus();
    return () => {
      closing.current = setTimeout(() => session.close(), 0);
    };
  }, [session]);

  const cardButton = (id: string, selector = "button") => document.getElementById(`assist-card-${id}`)?.querySelector<HTMLElement>(selector);
  const boxOrHeading = () => (boxRef.current && !boxRef.current.disabled ? boxRef.current : headingRef.current);
  const focusSoon = (find: () => HTMLElement | null | undefined) => requestAnimationFrame(() => find()?.focus());

  // Each new assistant line is announced; focus goes to its first card, else the text box.
  useEffect(() => {
    const assistant = state.lines.filter((l) => l.speaker === "assistant");
    if (assistant.length <= seen.current) return;
    seen.current = assistant.length;
    const line = assistant.at(-1)!;
    announce(line.text);
    const first = state.cards.find((c) => c.lineId === line.id && c.state === "open");
    requestAnimationFrame(() => {
      const target = first ? document.getElementById(`assist-card-${first.id}`)?.querySelector("button") : null;
      (target ?? boxRef.current)?.focus();
    });
  }, [state.lines, state.cards, announce]);

  const full = session.userCount() >= ASSIST_USER_MAX;
  const send = () => {
    const text = draft.trim();
    if (!text || state.status !== "idle" || full) return;
    setDraft("");
    void session.send(text);
  };

  const keep = async (card: AssistCard, edited?: { draft?: DraftNote; phraseText?: string }) => {
    setEditing(null);
    setConfirmDelete(null);
    let outcome: KeepOutcome;
    try {
      outcome = await session.keep(card.id, edited);
    } catch {
      announce("Couldn't save that. Try again.");
      focusSoon(() => cardButton(card.id));
      return;
    }
    if (outcome === "kept") {
      onChanged();
      announce(card.action === "remove" ? "Deleted" : "Kept");
    } else if (outcome === "duplicate") announce("You already have this.");
    else if (outcome === "changed") announce("This note has changed since.");
    focusSoon(boxOrHeading);
  };

  const skip = (card: AssistCard) => {
    const next = state.cards.find((c) => c.state === "open" && c.id !== card.id);
    session.skip(card.id);
    focusSoon(() => (next ? cardButton(next.id) : boxOrHeading()));
  };
  const cancelEdit = (card: AssistCard) => {
    setEditing(null);
    focusSoon(() => cardButton(card.id, 'button[aria-label^="Edit:"]'));
  };

  const renderCard = (card: AssistCard) => {
    const group = card.draft ? KIND_LABELS[card.draft.kind].group : KIND_LABELS[memory.getNote(card.noteId ?? "")?.kind ?? "routine"].group;
    const sources = card.sources.map((s, i) => (
      <p key={i} className="text-label text-muted break-words">
        You said: &ldquo;{s}&rdquo;
      </p>
    ));
    const notice = card.changed ? "This note has changed since." : undefined;
    const common = { id: `assist-card-${card.id}`, sources, notice, editing: editing === card.id, onEdit: () => setEditing(card.id), onSkip: () => skip(card) };
    let body;
    if (card.action === "phrase") {
      const text = card.phrase!.text;
      body = (
        <SuggestionCard
          {...common}
          heading={`Quick phrase${card.phrase!.forName ? ` for ${card.phrase!.forName}` : ""}`}
          text={text}
          onKeep={() => void keep(card)}
          editForm={<PhraseForm initial={text} onSave={(t) => void keep(card, { phraseText: t })} onCancel={() => cancelEdit(card)} />}
        />
      );
    } else if (card.action === "remove") {
      body =
        confirmDelete === card.id ? (
          <li key={card.id} id={`assist-card-${card.id}`} className="flex flex-col gap-3 rounded-control border-2 border-ink/15 bg-surface px-4 py-3">
            <p className="text-body font-bold">Delete this note?</p>
            <p className="text-body break-words">{card.oldText}</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" className={primaryButton} autoFocus onClick={() => void keep(card)}>
                Delete
              </button>
              <button type="button" className={secondaryButton} onClick={() => {
                  setConfirmDelete(null);
                  focusSoon(() => cardButton(card.id));
                }}>
                Cancel
              </button>
            </div>
          </li>
        ) : (
          <SuggestionCard {...common} heading={`Remove a note: ${group}`} text={card.oldText ?? ""} keepLabel="Delete" canEdit={false} canKeep={!card.changed} onKeep={() => setConfirmDelete(card.id)} />
        );
    } else {
      const text = composeNoteText(card.draft!);
      body = (
        <SuggestionCard
          {...common}
          heading={card.action === "edit" ? `Change a note: ${group}` : `New note: ${group}`}
          current={card.action === "edit" ? (memory.getNote(card.noteId!)?.text ?? card.oldText) : undefined}
          text={text}
          canKeep={!card.changed}
          onKeep={() => void keep(card)}
          editForm={
            <NoteForm
              kind={card.draft!.kind}
              initial={{ name: card.draft!.name ?? "", text: card.draft!.text }}
              submitLabel="Keep"
              autoFocus
              onSave={(d) => void keep(card, { draft: d })}
              onCancel={() => cancelEdit(card)}
            />
          }
        />
      );
    }
    return <Fragment key={card.id}>{body}</Fragment>;
  };

  const open = session.openCount();
  const close = () => (open > 0 ? setLeaving(true) : onClose());

  return (
    <section aria-labelledby="assistant-heading" className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="assistant-heading" ref={headingRef} tabIndex={-1} className="text-caption font-bold text-balance">
          Assistant
        </h2>
        {leaving ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-body font-bold">
              Leave without keeping {open} {open === 1 ? "change" : "changes"}?
            </p>
            <button type="button" className={primaryButton} autoFocus onClick={onClose}>
              Leave
            </button>
            <button type="button" className={secondaryButton} onClick={() => {
                setLeaving(false);
                focusSoon(() => closeRef.current);
              }}>
              Stay
            </button>
          </div>
        ) : (
          <button type="button" ref={closeRef} className={secondaryButton} onClick={close}>
            Close
          </button>
        )}
      </div>

      {state.lines.length === 0 && (
        <div className="flex flex-col gap-4">
          <p className="text-body font-bold">What would you like to do?</p>
          <div className="flex flex-col gap-3 sm:max-w-md">
            {JOBS.map((job) => (
              <button key={job} type="button" className={`${secondaryButton} text-left`} onClick={() => void session.chooseJob(job)}>
                {JOB_TEXT[job]}
              </button>
            ))}
          </div>
          <p className="max-w-[60ch] text-body text-muted">{NOTICE}</p>
        </div>
      )}

      {state.lines.length > 0 && (
        <ol className="flex flex-col gap-4">
          {state.lines.map((line) => (
            <li key={line.id} className="flex flex-col gap-3">
              <p className={`text-body break-words ${line.speaker === "user" ? "font-semibold" : ""}`}>
                <span className="font-bold">{line.speaker === "user" ? "You: " : "Assistant: "}</span>
                {line.text}
              </p>
              {line.failed && (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-body font-bold">Not sent.</p>
                  <button type="button" className={secondaryButton} onClick={() => void session.retry()} disabled={state.status !== "idle"}>
                    Try again
                  </button>
                </div>
              )}
              {line.speaker === "assistant" && state.cards.some((c) => c.lineId === line.id && c.state === "open") && (
                <ul className="flex flex-col gap-4">{state.cards.filter((c) => c.lineId === line.id && c.state === "open").map(renderCard)}</ul>
              )}
            </li>
          ))}
        </ol>
      )}

      <p role="status" className="text-body text-muted">
        {state.status === "waiting" ? "The assistant is typing" : state.status === "rate_limited" ? "Please wait a moment." : ""}
      </p>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label htmlFor="assist-message" className={fieldLabel}>
          Message to the assistant
        </label>
        <textarea
          id="assist-message"
          ref={boxRef}
          className={textArea}
          rows={2}
          maxLength={500}
          value={draft}
          disabled={full}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {full && <p className={hint}>Close this chat and start a new one to carry on.</p>}
        <div>
          <button type="submit" className={primaryButton} disabled={full || state.status !== "idle" || !draft.trim()}>
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
