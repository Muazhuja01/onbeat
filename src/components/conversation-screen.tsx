"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { personas, type Persona } from "@/data/personas";
import { conversationReducer, initialConversation } from "@/lib/conversation/reducer";
import { useReplyShortcuts } from "@/lib/conversation/use-shortcuts";
import { useStableTargets } from "@/lib/conversation/use-stable-targets";
import { useSuggestions } from "@/lib/conversation/use-suggestions";
import { en } from "@/lib/language-packs/en";
import { getBrowserMemory } from "@/lib/memory/browser";
import { MemoryStore } from "@/lib/memory/store";
import { SuggestClient } from "@/lib/suggest/client";
import { getBrowserVoice } from "@/lib/voice/browser";
import type { VoiceEngine, VoiceMode } from "@/lib/voice/engine";
import { AnnouncerProvider, useAnnounce } from "./announcer";
import { CaptionLog } from "./caption-log";
import { Composer } from "./composer";
import { ContextBar } from "./context-bar";
import { PartnerInput } from "./partner-input";
import { ProfilePicker } from "./profile-picker";
import { ReactionBar } from "./reaction-bar";
import { ReplyList } from "./reply-list";
import { SpokenCaption } from "./spoken-caption";
import { VoiceStatus } from "./voice-status";

const subscribeNever = () => () => {};
const noVoice = (): VoiceEngine | null => null;

function isTextField(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function ConversationScreen() {
  return (
    <AnnouncerProvider>
      <Screen />
    </AnnouncerProvider>
  );
}

function Screen() {
  const announce = useAnnounce();
  const [memory, setMemory] = useState<MemoryStore | null>(null);
  const [notesVersion, setNotesVersion] = useState(0);
  const [showProfiles, setShowProfiles] = useState(false);
  const [voiceProgress, setVoiceProgress] = useState(0);
  const [state, dispatch] = useReducer(conversationReducer, initialConversation);

  useEffect(() => {
    let cancelled = false;
    void getBrowserMemory()
      .catch((err) => {
        // A failed load (e.g. IndexedDB unavailable or blocked) must not
        // leave the page blank forever: fall back to a session-only store.
        console.error("getBrowserMemory failed, falling back to a session-only store", err);
        return MemoryStore.create();
      })
      .then((m) => {
        if (cancelled) return;
        setMemory(m);
        if (!m.isDurable) dispatch({ type: "notice", text: "Notes won't be saved in this window." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The voice engine is an external store: read it (and its mode) with
  // useSyncExternalStore rather than copying it into state inside an effect.
  // The server snapshot is null/"loading", so the engine is only created in the browser.
  const voice = useSyncExternalStore(subscribeNever, getBrowserVoice, noVoice);
  const subscribeMode = useCallback((cb: () => void) => (voice ? voice.on("mode", cb) : () => {}), [voice]);
  const voiceMode = useSyncExternalStore<VoiceMode>(subscribeMode, () => voice?.mode ?? "loading", () => "loading");

  useEffect(() => {
    if (!voice) return;
    const offs = [
      voice.on("progress", setVoiceProgress),
      voice.on("start", (text) => {
        dispatch({ type: "speakStart", id: crypto.randomUUID(), text, at: Date.now() });
        navigator.vibrate?.(40);
      }),
      voice.on("end", (text) => dispatch({ type: "speakEnd", text })),
    ];
    voice.load();
    return () => offs.forEach((off) => off());
  }, [voice]);

  const client = useMemo(() => (memory ? new SuggestClient({ memory, pack: en }) : null), [memory]);

  const replyListRef = useRef<HTMLElement>(null);
  const releaseHeld = useCallback(() => dispatch({ type: "releaseHeld" }), []);
  const isHolding = useStableTargets(replyListRef, releaseHeld);
  useSuggestions({ client, memory, state, dispatch, isHolding });

  useEffect(() => {
    if (!voice) return;
    for (const r of state.replies) voice.prepare(r.text);
  }, [voice, state.replies]);

  // Every new set of replies on screen is announced; queued updates collapse to the latest.
  useEffect(() => {
    const n = state.replies.length;
    if (n) announce(n === 1 ? "1 reply ready" : `${n} replies ready`, "replies");
  }, [state.replies, announce]);

  const speak = useCallback(
    (text: string, opts?: { isReaction?: boolean }) => {
      const t = text.trim();
      if (!t || !voice) return;
      void voice.speak(t);
      // A quick reaction (e.g. "Thanks!") isn't a phrase the user composed;
      // saving it would pollute their saved phrases.
      if (opts?.isReaction) return;
      void memory?.addPhrase(t, { now: new Date(), placeId: state.placeId, partnerId: state.partnerId }).then(() => {
        // A cached result embeds style examples drawn from phrases, so a new
        // phrase makes the cache stale (mirrors R13's reasoning for choosePersona).
        client?.clearCache();
      });
    },
    [voice, memory, client, state.placeId, state.partnerId],
  );
  const stop = useCallback(() => voice?.stop(), [voice]);

  const focusReplies = useCallback(() => {
    replyListRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  const [skippedProfiles, setSkippedProfiles] = useState(false);
  const notes = useMemo(() => (memory ? memory.notes() : []), [memory, notesVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const places = notes.filter((n) => n.kind === "place");
  const people = notes.filter((n) => n.kind === "person");
  const partnerName = (state.partnerId && memory?.getNote(state.partnerId)?.entities[0]) || "Them";
  const needsProfile = memory !== null && (showProfiles || (notes.length === 0 && !skippedProfiles));
  // The conversation view stays mounted (useStableTargets attaches to the reply
  // list once, on mount); it is only hidden while loading or picking a profile.
  const conversationHidden = memory === null || needsProfile;

  // Each new line from the partner is announced.
  const lastPartnerTurn = state.turns.findLast((t) => t.speaker === "partner");
  const announcedTurnId = useRef<string | null>(null);
  useEffect(() => {
    if (!lastPartnerTurn || announcedTurnId.current === lastPartnerTurn.id) return;
    announcedTurnId.current = lastPartnerTurn.id;
    announce(`${partnerName} said: ${lastPartnerTurn.text}`);
  }, [lastPartnerTurn, partnerName, announce]);

  useReplyShortcuts({
    enabled: !conversationHidden,
    replyCount: state.replies.length,
    reactionCount: state.reactions.length,
    onReply: (i) => speak(state.replies[i]?.text ?? ""),
    onReaction: (i) => speak(state.reactions[i]?.text ?? "", { isReaction: true }),
    onEscape: () => {
      if (state.speaking) {
        stop();
        return;
      }
      // Clear the reply box only when Escape wasn't meant for another field.
      const focused = document.activeElement;
      if (focused?.id === "composer" || !isTextField(focused)) dispatch({ type: "typed", text: "" });
    },
  });

  // Dismissing the picker removes its focused button from the page. Left alone,
  // the browser's next Tab lands wherever that button used to be in the tree
  // instead of the page's actual start, so focus is reset to the top here.
  const resetFocusToTop = () => {
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
    document.body.removeAttribute("tabindex");
  };

  const choosePersona = useCallback(
    async (p: Persona) => {
      if (!memory) return;
      // Cancel any request in flight for the old profile first, so its late
      // result never lands on the new profile's screen.
      client?.cancel();
      await memory.replaceAll(p.notes, p.phrases);
      // Notes and phrases changed, so cached suggestions are stale (R13).
      client?.clearCache();
      dispatch({ type: "reset" });
      dispatch({ type: "setContext", placeId: p.defaultPlaceId, partnerId: p.defaultPartnerId });
      setNotesVersion((v) => v + 1);
      setShowProfiles(false);
      resetFocusToTop();
    },
    [memory, client],
  );

  const closeProfiles = () => {
    setSkippedProfiles(true);
    setShowProfiles(false);
    resetFocusToTop();
  };
  const openOrCloseProfiles = () => {
    if (needsProfile) return closeProfiles();
    // The Stop button is about to be hidden, so stop any speech now.
    if (state.speaking) stop();
    setShowProfiles(true);
  };

  return (
    <>
      <header className="mx-auto flex w-full max-w-[90rem] flex-wrap items-center justify-between gap-4 px-4 py-4 lg:px-8">
        <p className="text-2xl font-extrabold tracking-tight" translate="no">
          OnBeat
        </p>
        <button
          type="button"
          onClick={openOrCloseProfiles}
          aria-expanded={needsProfile}
          className="min-h-12 rounded-control border-2 border-ink/30 px-4 text-label font-bold whitespace-nowrap transition-[border-color] duration-150 hover:border-ink sm:text-body"
        >
          Example profiles
        </button>
      </header>
      <main id="main" className="mx-auto w-full max-w-[90rem] px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] lg:px-8">
        <h1 className="sr-only">Conversation</h1>
        {/* Always mounted, so screen readers hear the notice when its text changes. */}
        <div role="status">
          {state.notice && <p className="mb-4 rounded-control border-2 border-ink/30 px-4 py-3 text-body">{state.notice}</p>}
        </div>
        {needsProfile && <ProfilePicker personas={personas} onChoose={(p) => void choosePersona(p)} onSkip={closeProfiles} />}
        <div className="conv-grid" hidden={conversationHidden}>
          <div className="[grid-area:context]">
            <ContextBar
              places={places}
              people={people}
              placeId={state.placeId}
              partnerId={state.partnerId}
              onChange={(placeId, partnerId) => dispatch({ type: "setContext", placeId, partnerId })}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-6 [grid-area:log]">
            <CaptionLog turns={state.turns} partnerName={partnerName} />
            <PartnerInput onSubmit={(text) => dispatch({ type: "partnerSaid", id: crypto.randomUUID(), text, at: Date.now() })} />
          </div>
          <div className="flex min-w-0 flex-col gap-6 [grid-area:side]">
            <SpokenCaption speaking={state.speaking} lastSpoken={state.lastSpoken} />
            <ReactionBar reactions={state.reactions} onReact={(text) => speak(text, { isReaction: true })} />
            <ReplyList ref={replyListRef} replies={state.replies} speaking={state.speaking} status={state.status} onSpeak={speak} onStop={stop} />
            <Composer
              value={state.typed}
              onChange={(text) => dispatch({ type: "typed", text })}
              onSpeak={speak}
              onFocusReplies={focusReplies}
            />
            <VoiceStatus mode={voiceMode} progress={voiceProgress} />
          </div>
        </div>
      </main>
    </>
  );
}
