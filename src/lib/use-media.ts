import { useCallback, useSyncExternalStore } from "react";

/** From this width the top bar has room for the place and person chips, the gear and "+ They said" in the type row. */
export const WIDE = "(min-width: 40rem)";

/** Whether a media query matches. `serverValue` is used on the server and where the browser can't tell. */
export function useMedia(query: string, serverValue = true): boolean {
  const supported = () => typeof window !== "undefined" && typeof window.matchMedia === "function";
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!supported()) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => (supported() ? window.matchMedia(query).matches : serverValue), () => serverValue);
}
