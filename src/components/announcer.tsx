"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const AnnounceContext = createContext<(message: string) => void>(() => {});

/** Polite live region, at most one announcement per second. */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const announce = useCallback((next: string) => {
    clearTimeout(timer.current);
    const wait = Math.max(0, 1000 - (Date.now() - last.current));
    timer.current = setTimeout(() => {
      last.current = Date.now();
      setMessage("");
      timer.current = setTimeout(() => setMessage(next), 50);
    }, wait);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div role="status" aria-live="polite" className="sr-only">
        {message}
      </div>
    </AnnounceContext.Provider>
  );
}

export function useAnnounce(): (message: string) => void {
  return useContext(AnnounceContext);
}
