import { useCallback, useEffect, useRef, type Dispatch } from "react";
import type { MemoryStore } from "@/lib/memory/store";
import { SuggestUnavailableError, type SuggestClient, type SuggestInput } from "@/lib/suggest/client";
import type { ConversationAction, ConversationState } from "./reducer";

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

  const lastPartner = state.turns.findLast((t) => t.speaker === "partner");
  const partnerTurnId = lastPartner?.id ?? "";

  const run = useCallback(
    async (mode: SuggestInput["mode"], typed: string, partnerSaid: string) => {
      if (!client) return;
      const s = stateRef.current;
      dispatch({ type: "thinking" });
      try {
        await client.request(
          { mode, typed, partnerSaid, context: { now: new Date(), placeId: s.placeId, partnerId: s.partnerId } },
          (u) => dispatch({ type: "suggestions", replies: u.replies, reactions: u.reactions, done: u.done, hold: holdingRef.current() }),
        );
      } catch (err) {
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
      }
    },
    [client, dispatch],
  );

  // The partner finished a turn: ask right away, with reactions.
  useEffect(() => {
    if (!partnerTurnId) return;
    const s = stateRef.current;
    const said = s.turns.findLast((t) => t.speaker === "partner")?.text ?? "";
    void run("replies+reactions", s.typed, said);
  }, [partnerTurnId, run]);

  // Typing: instant matches from the user's phrases, model after a pause.
  const typed = state.typed;
  useEffect(() => {
    const t = typed.trim();
    if (!t) {
      // The user cleared what they typed (or spoke it): a request already in
      // flight for the old text must not land its replies late.
      client?.cancel();
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
      void run("replies", typed, said);
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
    if (said || s.typed.trim().length >= 2) void run(said ? "replies+reactions" : "replies", s.typed, said);
  }, [contextKey, run]);
}
