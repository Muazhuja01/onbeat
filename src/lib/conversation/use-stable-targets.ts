import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * While the pointer is over the list (and moving) or a reply has focus, new
 * suggestions wait, so a reply never changes under someone's finger.
 * Released when the pointer leaves, focus leaves, or after idleMs of stillness.
 */
export function useStableTargets(ref: RefObject<HTMLElement | null>, onRelease: () => void, idleMs = 1500): () => boolean {
  const inside = useRef(false);
  const focused = useRef(false);
  const lastActivity = useRef(0);
  const releaseRef = useRef(onRelease);
  useEffect(() => {
    releaseRef.current = onRelease;
  });

  const isHolding = useCallback(
    () => (inside.current || focused.current) && Date.now() - lastActivity.current < idleMs,
    [idleMs],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      clearTimeout(timer);
      releaseRef.current();
    };
    const activity = () => {
      lastActivity.current = Date.now();
      clearTimeout(timer);
      timer = setTimeout(release, idleMs);
    };
    const onEnter = () => {
      inside.current = true;
      activity();
    };
    const onLeave = () => {
      inside.current = false;
      release();
    };
    const onFocusIn = () => {
      focused.current = true;
      activity();
    };
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
      focused.current = false;
      release();
    };
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointermove", activity);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);
    el.addEventListener("keydown", activity);
    return () => {
      clearTimeout(timer);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointermove", activity);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
      el.removeEventListener("keydown", activity);
    };
  }, [ref, idleMs]);

  return isHolding;
}
