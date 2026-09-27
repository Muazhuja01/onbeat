import { useEffect, useRef } from "react";

interface Args {
  replyCount: number;
  reactionCount: number;
  onReply: (index: number) => void;
  onReaction: (index: number) => void;
  onEscape: () => void;
  enabled?: boolean;
}

function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function useReplyShortcuts(args: Args): void {
  const ref = useRef(args);
  useEffect(() => {
    ref.current = args;
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const a = ref.current;
      if (a.enabled === false) return;
      if (e.key === "Escape") {
        a.onEscape();
        return;
      }
      // A held key auto-repeats (e.g. speaking "1" over and over) and Shift
      // changes the character on many layouts; ignore both.
      if (e.repeat || e.shiftKey || e.ctrlKey || e.metaKey) return;
      // With Alt, some layouts change e.key; e.code stays "Digit1".
      const digit = /^Digit([1-9])$/.exec(e.code)?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : null);
      if (!digit) return;
      const index = Number(digit) - 1;
      if (e.altKey) {
        // Reactions stay reachable while typing: the partner may be talking
        // while the user has focus in the text field.
        if (index < a.reactionCount) {
          e.preventDefault();
          a.onReaction(index);
        }
        return;
      }
      if (inTextField(e.target)) return;
      if (index < a.replyCount) {
        e.preventDefault();
        a.onReply(index);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
