"use client";

import { CaretDown, UserCircle } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { NAME_MAX, type ProfileInfo } from "@/lib/profiles/registry";
import { fieldLabel, hint, primaryButton, secondaryButton, textField } from "./ui";

interface Props {
  profiles: ProfileInfo[];
  activeId: string | null;
  /** Set while a demo is open. */
  demoName: string | null;
  onSwitch: (id: string) => void;
  onNotes: () => void;
  onNew: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDemo: () => void;
}

const item = `${secondaryButton} w-full text-left`;

export function ProfileMenu(props: Props) {
  const { profiles, activeId, demoName } = props;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"list" | "rename" | "delete">("list");
  const [draftName, setDraftName] = useState("");
  const toggleRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const active = profiles.find((p) => p.id === activeId) ?? null;
  const others = profiles.filter((p) => p.id !== activeId || demoName);
  const label = demoName ? `Demo: ${demoName}` : (active?.name ?? "Profiles");

  const close = (refocus = true) => {
    setOpen(false);
    setMode("list");
    if (refocus) toggleRef.current?.focus();
  };
  const act = (action: () => void) => {
    close();
    action();
  };

  // Clicking elsewhere closes the panel, as with any menu that isn't modal.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setMode("list");
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className="relative min-w-0 max-w-full"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => (open ? close(false) : setOpen(true))}
        className="flex min-h-12 max-w-full sm:max-w-[16rem] items-center gap-2 rounded-control border-2 border-ink/30 px-4 text-label font-bold transition-[border-color] duration-150 hover:border-ink sm:text-body"
      >
        <UserCircle aria-hidden="true" size={22} className="shrink-0" />
        <span className="truncate">{label}</span>
        <CaretDown aria-hidden="true" size={18} className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          id={`${id}-panel`}
          className="absolute top-full right-0 z-20 mt-2 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 rounded-control border-2 border-ink/30 bg-surface p-4 shadow-lg"
        >
          {mode === "rename" && active ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!draftName.trim()) return;
                props.onRename(draftName);
                close();
              }}
            >
              <label htmlFor={`${id}-name`} className={fieldLabel}>
                Profile name
              </label>
              <input
                id={`${id}-name`}
                type="text"
                maxLength={NAME_MAX}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                autoFocus
                className={textField}
              />
              <div className="flex flex-wrap gap-3">
                <button type="submit" disabled={!draftName.trim()} className={primaryButton}>
                  Save
                </button>
                <button type="button" onClick={() => setMode("list")} className={secondaryButton}>
                  Cancel
                </button>
              </div>
            </form>
          ) : mode === "delete" && active ? (
            <div className="flex flex-col gap-3">
              <p className="text-body">
                Delete {active.name}? Their notes and phrases will be removed from this browser. Export first if you might want them back.
              </p>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => act(props.onDelete)} className={primaryButton}>
                  Delete {active.name}
                </button>
                <button type="button" onClick={() => setMode("list")} autoFocus className={secondaryButton}>
                  Keep
                </button>
              </div>
            </div>
          ) : (
            <>
              {demoName && (
                <>
                  <button type="button" onClick={() => act(props.onNew)} className={primaryButton}>
                    Set up your own profile
                  </button>
                  <button type="button" onClick={() => act(props.onDemo)} className={item}>
                    Try another demo
                  </button>
                </>
              )}
              {others.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h2 className={fieldLabel}>{demoName ? "Your profiles" : "Other profiles"}</h2>
                  {others.map((p) => (
                    <button key={p.id} type="button" onClick={() => act(() => props.onSwitch(p.id))} className={item}>
                      Switch to {p.name}
                    </button>
                  ))}
                </div>
              )}
              {!demoName && active && (
                <>
                  <button type="button" onClick={() => act(props.onNotes)} className={item}>
                    Your notes
                  </button>
                  <button type="button" onClick={() => act(props.onNew)} className={item}>
                    New profile
                  </button>
                  <div className="flex flex-col gap-1">
                    <button type="button" onClick={() => act(props.onExport)} aria-describedby={`${id}-export-hint`} className={item}>
                      Export this profile
                    </button>
                    <p id={`${id}-export-hint`} className={hint}>
                      Saves a file you can import later or on another device.
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${id}-import`} className={fieldLabel}>
                      Import a profile
                    </label>
                    <input
                      id={`${id}-import`}
                      type="file"
                      accept=".json,application/json"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        close();
                        props.onImport(file);
                      }}
                      className="min-h-12 max-w-full text-label file:mr-3 file:min-h-12 file:rounded-control file:border-2 file:border-ink/40 file:bg-surface file:px-4 file:font-bold file:text-ink"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftName(active.name);
                      setMode("rename");
                    }}
                    className={item}
                  >
                    Rename
                  </button>
                  <button type="button" onClick={() => setMode("delete")} className={item}>
                    Delete this profile
                  </button>
                  <button type="button" onClick={() => act(props.onDemo)} className={item}>
                    Try a demo
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
