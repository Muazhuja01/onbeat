"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Announce a message. Messages queue so none is lost (e.g. a caption line
 * followed quickly by new replies); a queued message with the same `key` is
 * replaced by the newer one, so fast updates collapse to the latest.
 */
type Announce = (message: string, key?: string) => void;

const AnnounceContext = createContext<Announce>(() => {});

const GAP_MS = 1000;
const CLEAR_MS = 50;

/** A queue that shows at most one message per GAP_MS, clearing the region briefly before each. */
function createAnnouncer(show: (message: string) => void) {
  const queue: { text: string; key?: string }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = -Infinity;

  const pump = () => {
    if (timer !== undefined || queue.length === 0) return;
    timer = setTimeout(
      () => {
        last = Date.now();
        show("");
        timer = setTimeout(() => {
          timer = undefined;
          const next = queue.shift();
          if (next) show(next.text);
          pump();
        }, CLEAR_MS);
      },
      Math.max(0, GAP_MS - (Date.now() - last)),
    );
  };

  const announce: Announce = (text, key) => {
    const same = key === undefined ? -1 : queue.findIndex((m) => m.key === key);
    if (same >= 0) queue[same] = { text, key };
    else queue.push({ text, key });
    pump();
  };

  const dispose = () => {
    clearTimeout(timer);
    timer = undefined;
    queue.length = 0;
  };

  return { announce, dispose };
}

/** Polite live region, at most one announcement per second. */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const announcer = useMemo(() => createAnnouncer(setMessage), []);
  useEffect(() => announcer.dispose, [announcer]);

  return (
    <AnnounceContext.Provider value={announcer.announce}>
      {children}
      <div role="status" aria-live="polite" className="sr-only">
        {message}
      </div>
    </AnnounceContext.Provider>
  );
}

export function useAnnounce(): Announce {
  return useContext(AnnounceContext);
}
