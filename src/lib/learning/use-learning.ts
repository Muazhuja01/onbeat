"use client";

import { useEffect, useState } from "react";
import type { MemoryStore } from "@/lib/memory/store";
import type { KeyValue } from "@/lib/profiles/kv";
import { LearningSession } from "./session";
import type { PendingSuggestion } from "./types";

interface Live {
  memory: MemoryStore;
  session: LearningSession;
  suggestions: PendingSuggestion[];
}

/**
 * A learning session for the open profile and its waiting suggestions. None for a demo
 * (no profile id). Each profile switch opens a new memory store, so a session is only
 * used while its own store is the open one.
 */
export function useLearningSession(opts: { kv: KeyValue | null; profileId: string | null; memory: MemoryStore | null; enabled: boolean }) {
  const { kv, profileId, memory, enabled } = opts;
  const [live, setLive] = useState<Live | null>(null);

  useEffect(() => {
    if (!kv || !profileId || !memory) return;
    let cancelled = false;
    let opened: LearningSession | null = null;
    let off = () => {};
    void LearningSession.open({ kv, profileId, memory, enabled }).then((session) => {
      if (cancelled) {
        session.dispose();
        return;
      }
      opened = session;
      off = session.pending.onChange(() => setLive((cur) => (cur?.session === session ? { ...cur, suggestions: session.pending.list() } : cur)));
      setLive({ memory, session, suggestions: session.pending.list() });
    });
    return () => {
      cancelled = true;
      off();
      opened?.dispose();
    };
    // `enabled` is applied to the open session by the effect below, not by reopening it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kv, profileId, memory]);

  const current = live && profileId && live.memory === memory ? live : null;
  const session = current?.session ?? null;

  useEffect(() => {
    void session?.setEnabled(enabled);
  }, [session, enabled]);

  useEffect(() => {
    if (!session) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") session.pageHidden();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [session]);

  return { session, suggestions: current?.suggestions ?? [] };
}
