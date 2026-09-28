import { useCallback, useEffect, useRef, type Dispatch } from "react";
import type { MemoryStore } from "@/lib/memory/store";
import type { RequestPriority } from "@/lib/suggest/budget";
import { SuggestSkippedError, SuggestUnavailableError, type SuggestClient, type SuggestInput } from "@/lib/suggest/client";
import type { ConversationAction, ConversationState } from "./reducer";

type Run = (mode: SuggestInput["mode"], typed: string, partnerSaid: string, priority: RequestPriority) => Promise<boolean>;

interface Args {
  client: SuggestClient | null;
  memory: MemoryStore | null;
  state: ConversationState;
  dispatch: Dispatch<ConversationAction>;
  isHolding: () => boolean;
  debounceMs?: number;
}

export function useSuggestions({ client, memory, state, dispatch, isHolding, debounceMs = 300 }: Args): void {
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // R2: keep a latest-value ref for isHolding so its identity never appears in
  // an effect/callback dependency array (the brief's own tests pass an
  // inline `() => false`, which would otherwise re-run effects every render).
  const holdingRef = useRef(isHolding);
  useEffect(() => {
    holdingRef.current = isHolding;
  });

  // R15: the trimmed typed text as of the last time the typing effect ran,
  // so a rerun caused only by `client`/`run` changing identity (e.g. the
  // client going from null to an instance) is not mistaken for the user
  // clearing the field.
  const prevTypedRef = useRef("");

  // A request skipped for budget reasons is asked again later (see run).
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(retryTimer.current), []);
  const runRef = useRef<Run>(async () => false);

  const lastPartner = state.turns.findLast((t) => t.speaker === "partner");
  const partnerTurnId = lastPartner?.id ?? "";

  const run = useCallback<Run>(
    async (mode, typed, partnerSaid, priority) => {
      if (!client) return false;
      clearTimeout(retryTimer.current);
      const s = stateRef.current;
      dispatch({ type: "thinking" });
      try {
        const final = await client.request(
          { mode, typed, partnerSaid, priority, context: { now: new Date(), placeId: s.placeId, partnerId: s.partnerId } },
          (u) => dispatch({ type: "suggestions", replies: u.replies, reactions: u.reactions, done: u.done, hold: holdingRef.current() }),
        );
        return final !== null;
      } catch (err) {
        if (err instanceof SuggestSkippedError) {
          // Over budget (spec 5, quota guard). Speculative requests are dropped;
          // typed and final ones are asked again once the budget allows.
          dispatch({ type: "cancelled" });
          if (priority !== "speculative") {
            retryTimer.current = setTimeout(() => {
              const latest = stateRef.current;
              if (priority === "typed" && !latest.typed.trim()) return;
              void runRef.current(mode, priority === "typed" ? latest.typed : typed, partnerSaid, priority);
            }, err.retryInMs);
          }
          return false;
        }
        if (err instanceof SuggestUnavailableError) {
          dispatch({ type: "unavailable" });
        } else {
          // Any other error (e.g. memory.searchNotes rejecting, a parser
          // throw) must not become an unhandled rejection here, since every
          // call site uses `void run(...)`. Treat it the same as the
          // service being unavailable so `status` doesn't stay "thinking".
          console.error("useSuggestions: unexpected error", err);
          dispatch({ type: "unavailable" });
        }
        return false;
      }
    },
    [client, dispatch],
  );
  useEffect(() => {
    runRef.current = run;
  });

  // The partner finished a turn: ask right away, with reactions.
  useEffect(() => {
    if (!partnerTurnId) return;
    const s = stateRef.current;
    const said = s.turns.findLast((t) => t.speaker === "partner")?.text ?? "";
    void run("replies+reactions", s.typed, said, "final");
  }, [partnerTurnId, run]);

  // Typing: instant matches from the user's phrases, model after a pause.
  const typed = state.typed;
  useEffect(() => {
    const t = typed.trim();
    // Only a real non-empty -> empty transition means the user cleared (or
    // spoke) what they typed. The effect also reruns when `client` or `run`
    // change identity alone (e.g. the client becomes available after being
    // null); that must not cancel a request another effect, such as the
    // partner-turn effect, just started on the same client.
    const clearedJustNow = prevTypedRef.current !== "" && !t;
    prevTypedRef.current = t;
    if (!t) {
      if (clearedJustNow) {
        client?.cancel();
        // The cancelled request may have left `status` stuck at "thinking"
        // (Task: stuck "Finding replies..."); resolve it now instead of
        // waiting for a response that will never come.
        dispatch({ type: "cancelled" });
      }
      return;
    }
    if (!memory) return;
    const local = memory.matchPhrases(t, 3).map((p) => ({ text: p.text, noteIds: [], source: "phrase" as const }));
    if (local.length) {
      dispatch({ type: "suggestions", replies: local, reactions: stateRef.current.reactions, done: false, hold: holdingRef.current() });
    }
    if (t.length < 2) return;
    const handle = setTimeout(() => {
      const said = stateRef.current.turns.findLast((x) => x.speaker === "partner")?.text ?? "";
      void run("replies", typed, said, "typed");
    }, debounceMs);
    return () => clearTimeout(handle);
  }, [typed, memory, client, run, dispatch, debounceMs]);

  // The place or partner changed: refresh if there is something to reply to.
  const contextKey = `${state.placeId ?? ""}|${state.partnerId ?? ""}`;
  const firstContext = useRef(true);
  useEffect(() => {
    if (firstContext.current) {
      firstContext.current = false;
      return;
    }
    const s = stateRef.current;
    const said = s.turns.findLast((t) => t.speaker === "partner")?.text ?? "";
    if (said || s.typed.trim().length >= 2) void run(said ? "replies+reactions" : "replies", s.typed, said, "final");
  }, [contextKey, run]);
}
