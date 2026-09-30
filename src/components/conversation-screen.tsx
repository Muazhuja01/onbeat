"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { personas, type Persona } from "@/data/personas";
import { conversationReducer, initialConversation } from "@/lib/conversation/reducer";
import { GapTimer, loadGaps, saveGap } from "@/lib/conversation/response-gap";
import { useReplyShortcuts } from "@/lib/conversation/use-shortcuts";
import { useStableTargets } from "@/lib/conversation/use-stable-targets";
import { useSuggestions } from "@/lib/conversation/use-suggestions";
import { getBrowserHearing } from "@/lib/hearing/browser";
import type { Hearing, HearingStatus } from "@/lib/hearing/engine";
import { en } from "@/lib/language-packs/en";
import { PendingStore } from "@/lib/learning/pending";
import { clearQueues } from "@/lib/learning/queue";
import type { PendingSuggestion } from "@/lib/learning/types";
import { useLearningSession } from "@/lib/learning/use-learning";
import { getBrowserRegistry, openDemoMemory, openProfileMemory } from "@/lib/memory/browser";
import type { MemoryStore } from "@/lib/memory/store";
import { memoryKeyValue } from "@/lib/profiles/kv";
import { buildNote, type DraftNote } from "@/lib/profiles/notes";
import { ProfileRegistry } from "@/lib/profiles/registry";
import { exportFileName, exportProfile, parseImport } from "@/lib/profiles/transfer";
import { getServerSettings, getSettings, learningTold, markLearningTold, setCloudCaptions, setDigitKeys, setLearning, setTheme, subscribeSettings } from "@/lib/settings";
import { SuggestClient } from "@/lib/suggest/client";
import type { Note } from "@/lib/types";
import { getBrowserVoice } from "@/lib/voice/browser";
import type { VoiceEngine, VoiceMode } from "@/lib/voice/engine";
import { AnnouncerProvider, useAnnounce } from "./announcer";
import { CaptionLog } from "./caption-log";
import { Composer } from "./composer";
import { ContextBar } from "./context-bar";
import { DemoBar } from "./demo-bar";
import { ListenControl } from "./listen-control";
import { NotesEditor } from "./notes-editor";
import { PartnerInput } from "./partner-input";
import { ProfileMenu } from "./profile-menu";
import { ProfilePicker } from "./profile-picker";
import { ProfileSetup } from "./profile-setup";
import { ReactionBar } from "./reaction-bar";
import { ReplyList } from "./reply-list";
import { SettingsPanel } from "./settings-panel";
import { ResponseGap } from "./response-gap";
import { SpokenCaption } from "./spoken-caption";
import { SuggestedNotes } from "./suggested-notes";
import { VoiceStatus } from "./voice-status";

const subscribeNever = () => () => {};
const noVoice = (): VoiceEngine | null => null;
const noHearing = (): Hearing | null => null;
const hasTimerFlag = () => new URLSearchParams(window.location.search).has("timer");

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

/** What fills the page. The conversation stays mounted underneath the others. */
type View = "loading" | "setup" | "demo-picker" | "notes" | "suggestions" | "conversation";

const SAVE_FAILED = "Couldn't save. Your browser's storage may be full.";
const LEARNING_NOTICE = "New: OnBeat can suggest notes from your conversations for you to review. Turn it off in Settings.";

function Screen() {
  const announce = useAnnounce();
  const [registry, setRegistry] = useState<ProfileRegistry | null>(null);
  // The registry is mutable; this counter re-renders after it changes.
  const [, setProfilesVersion] = useState(0);
  const [view, setView] = useState<View>("loading");
  const [demo, setDemo] = useState<Persona | null>(null);
  const [memory, setMemory] = useState<MemoryStore | null>(null);
  const [notesVersion, setNotesVersion] = useState(0);
  const [voiceProgress, setVoiceProgress] = useState(0);
  const [state, dispatch] = useReducer(conversationReducer, initialConversation);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let reg: ProfileRegistry;
      try {
        reg = await getBrowserRegistry();
      } catch (err) {
        // A failed load (e.g. IndexedDB blocked) must not leave the page blank:
        // profiles then live in memory for this visit.
        console.error("Loading profiles failed, keeping them for this visit only", err);
        reg = await ProfileRegistry.open(memoryKeyValue(), { durable: false });
      }
      const active = reg.active();
      const store = active ? await openProfileMemory(reg, active.id).catch(() => null) : null;
      if (cancelled) return;
      setRegistry(reg);
      setMemory(store);
      setView(store ? "conversation" : "setup");
    })();
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
  // Hearing is an external store like the voice (spec 4, hearing unit).
  const hearing = useSyncExternalStore(subscribeNever, getBrowserHearing, noHearing);
  const subscribeHearing = useCallback((cb: () => void) => (hearing ? hearing.on("status", cb) : () => {}), [hearing]);
  const hearingStatus = useSyncExternalStore<HearingStatus>(subscribeHearing, () => hearing?.status ?? "off", () => "off");
  const [hearingProgress, setHearingProgress] = useState(0);
  const showTimer = useSyncExternalStore(subscribeNever, hasTimerFlag, () => false);
  const settings = useSyncExternalStore(subscribeSettings, getSettings, getServerSettings);
  const [gaps, setGaps] = useState<number[]>(() => (typeof window === "undefined" ? [] : loadGaps()));
  const [gapTimer] = useState(() => new GapTimer((ms) => setGaps(saveGap(ms))));

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

  // The microphone would hear the app's own voice: pause while it speaks and a moment after.
  useEffect(() => {
    if (!voice || !hearing) return;
    const offs = [voice.on("start", () => hearing.pause()), voice.on("end", () => hearing.resume(400))];
    return () => offs.forEach((off) => off());
  }, [voice, hearing]);

  useEffect(() => {
    if (!hearing) return;
    const offs = [
      hearing.on("progress", setHearingProgress),
      hearing.on("speechStart", (at) => gapTimer.speechStarted(at)),
      hearing.on("partial", (text) => dispatch({ type: "partnerPartial", text })),
      hearing.on("turnEnd", ({ text, endedAt }) => {
        dispatch({ type: "partnerSaid", id: crypto.randomUUID(), text, at: Date.now() });
        gapTimer.turnEnded(endedAt);
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      hearing.stop();
    };
  }, [hearing, gapTimer]);

  const client = useMemo(() => (memory ? new SuggestClient({ memory, pack: en }) : null), [memory]);

  const activeProfileId = demo ? null : (registry?.active()?.id ?? null);
  const learning = useLearningSession({
    kv: registry?.keyValue ?? null,
    profileId: activeProfileId,
    memory,
    // Nothing is queued until the user has been told notes are suggested.
    enabled: settings.learning && learningTold(),
  });
  /** Who the user is talking with and where, for the lines learning keeps. */
  const lineContext = useCallback(
    () => ({
      partnerName: state.partnerId ? memory?.getNote(state.partnerId)?.entities[0] : undefined,
      placeName: state.placeId ? memory?.getNote(state.placeId)?.entities[0] : undefined,
    }),
    [memory, state.partnerId, state.placeId],
  );

  const replyListRef = useRef<HTMLElement>(null);
  const releaseHeld = useCallback(() => dispatch({ type: "releaseHeld" }), []);
  const isHolding = useStableTargets(replyListRef, releaseHeld);
  useSuggestions({ client, memory, state, dispatch, isHolding });

  useEffect(() => {
    if (!voice) return;
    for (const r of state.replies) voice.prepare(r.text);
  }, [voice, state.replies]);

  useEffect(() => {
    gapTimer.repliesShown(Date.now(), state.replies, state.repliesAskedAt);
  }, [state.replies, state.repliesAskedAt, gapTimer]);

  const toggleListening = () => {
    if (!hearing) return;
    if (hearingStatus === "listening" || hearingStatus === "loading") {
      hearing.stop();
      gapTimer.reset();
    } else void hearing.start();
  };

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
      // A reply tapped as it is came from the notes, maybe with an invented detail: only
      // the user's own words are learned from.
      if (!state.replies.some((r) => r.text.trim() === t)) void learning.session?.addLine({ speaker: "user", text: t, ...lineContext() });
      void memory?.addPhrase(t, { now: new Date(), placeId: state.placeId, partnerId: state.partnerId }).then(() => {
        // A cached result embeds style examples drawn from phrases, so a new
        // phrase makes the cache stale (mirrors R13's reasoning for choosePersona).
        client?.clearCache();
      });
    },
    [voice, memory, client, state.placeId, state.partnerId, state.replies, learning.session, lineContext],
  );
  const stop = useCallback(() => voice?.stop(), [voice]);

  const focusReplies = useCallback(() => {
    replyListRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  const notes = useMemo(() => (memory ? memory.notes() : []), [memory, notesVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const places = notes.filter((n) => n.kind === "place");
  const people = notes.filter((n) => n.kind === "person");
  const partnerName = (state.partnerId && memory?.getNote(state.partnerId)?.entities[0]) || "Them";
  // The conversation view stays mounted (useStableTargets attaches to the reply
  // list once, on mount); it is only hidden while another view is showing.
  const conversationHidden = memory === null || view !== "conversation";

  // Each new line from the partner is announced.
  const lastPartnerTurn = state.turns.findLast((t) => t.speaker === "partner");
  const announcedTurnId = useRef<string | null>(null);
  useEffect(() => {
    if (!lastPartnerTurn || announcedTurnId.current === lastPartnerTurn.id) return;
    announcedTurnId.current = lastPartnerTurn.id;
    announce(`${partnerName} said: ${lastPartnerTurn.text}`);
  }, [lastPartnerTurn, partnerName, announce]);

  // Each line from the partner goes to learning once.
  const learnedTurnIds = useRef(new Set<string>());
  useEffect(() => {
    for (const turn of state.turns) {
      if (turn.speaker !== "partner" || learnedTurnIds.current.has(turn.id)) continue;
      learnedTurnIds.current.add(turn.id);
      void learning.session?.addLine({ speaker: "partner", text: turn.text, ...lineContext() });
    }
  }, [state.turns, learning.session, lineContext]);

  // Profiles made before learning existed are told once, the first time they open.
  useEffect(() => {
    if (!memory || demo || view !== "conversation" || !settings.learning || learningTold()) return;
    markLearningTold();
    dispatch({ type: "notice", text: LEARNING_NOTICE });
  }, [memory, demo, view, settings.learning]);

  useReplyShortcuts({
    enabled: !conversationHidden,
    digitKeys: settings.digitKeys,
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

  const bumpProfiles = () => setProfilesVersion((v) => v + 1);

  /** Another view is about to cover the conversation, so its Stop button goes: stop speech now. */
  const leaveConversation = (next: View) => {
    if (state.speaking) stop();
    setView(next);
  };

  /** Shows a profile's or demo's notes with a fresh conversation. */
  const showMemory = (store: MemoryStore, context: { placeId?: string; partnerId?: string } = {}) => {
    // Cancel any request in flight for the old profile first, so its late
    // result never lands on the new profile's screen.
    client?.cancel();
    if (state.speaking) stop();
    dispatch({ type: "reset" });
    gapTimer.reset();
    dispatch({ type: "setContext", placeId: context.placeId, partnerId: context.partnerId });
    setMemory(store);
    setNotesVersion((v) => v + 1);
    setView("conversation");
    resetFocusToTop();
  };

  const finishSetup = async (name: string, made: Note[]) => {
    if (!registry) return;
    let store: MemoryStore;
    try {
      const profile = await registry.create(name);
      store = await openProfileMemory(registry, profile.id);
      await store.replaceAll(made, []);
    } catch {
      dispatch({ type: "notice", text: SAVE_FAILED });
      return;
    }
    // Ask the browser not to clear OnBeat's storage when space runs low. It decides; nothing is shown.
    void navigator.storage?.persist?.().catch(() => {});
    // The last setup step already said notes will be suggested.
    markLearningTold();
    setDemo(null);
    bumpProfiles();
    showMemory(store);
    dispatch({ type: "notice", text: "You can add or change notes any time from your profile menu." });
  };

  const switchTo = async (id: string) => {
    if (!registry) return;
    await registry.setActive(id);
    const store = await openProfileMemory(registry, id);
    setDemo(null);
    bumpProfiles();
    showMemory(store);
  };

  const startDemo = async (persona: Persona) => {
    const store = await openDemoMemory(persona);
    setDemo(persona);
    showMemory(store, { placeId: persona.defaultPlaceId, partnerId: persona.defaultPartnerId });
  };

  const saveNote = async (note: Note) => {
    if (!memory) return;
    try {
      await memory.upsertNote(note);
    } catch {
      dispatch({ type: "notice", text: SAVE_FAILED });
    }
    // Notes changed, so cached suggestions are stale (R13).
    client?.clearCache();
    setNotesVersion((v) => v + 1);
    announce("Note saved");
  };

  const removeNote = async (id: string) => {
    if (!memory) return;
    try {
      await memory.removeNote(id);
    } catch {
      dispatch({ type: "notice", text: SAVE_FAILED });
    }
    client?.clearCache();
    if (state.placeId === id || state.partnerId === id) {
      dispatch({ type: "setContext", placeId: state.placeId === id ? undefined : state.placeId, partnerId: state.partnerId === id ? undefined : state.partnerId });
    }
    setNotesVersion((v) => v + 1);
    announce("Note deleted");
  };

  const keepSuggestion = async (s: PendingSuggestion, draft: DraftNote) => {
    if (!memory || !learning.session) return;
    const target = s.noteId ? memory.getNote(s.noteId) : undefined;
    const note = buildNote(draft, target ? { id: target.id, pinned: target.pinned, now: Date.now() } : { now: Date.now() });
    try {
      await memory.upsertNote(note);
    } catch {
      dispatch({ type: "notice", text: SAVE_FAILED });
      return;
    }
    // Notes changed, so cached suggestions are stale (R13).
    client?.clearCache();
    setNotesVersion((v) => v + 1);
    await learning.session.pending.remove(s.id);
    announce("Kept");
  };

  const toggleLearning = (on: boolean) => {
    setLearning(on);
    if (!on && registry) void clearQueues(registry.keyValue, registry.list().map((p) => p.id));
  };

  const exportActive = () => {
    const active = registry?.active();
    if (!active || !memory) return;
    const now = new Date();
    const url = URL.createObjectURL(new Blob([exportProfile(active.name, memory.notes(), memory.phrases(), now, learning.suggestions)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFileName(active.name, now);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce("Profile exported");
  };

  const importFile = async (file: File) => {
    if (!registry) return;
    // Exports are small; anything this big isn't one, so don't read it all into memory.
    const parsed = file.size > 20 * 1024 * 1024 ? null : parseImport(await file.text());
    if (!parsed) {
      dispatch({ type: "notice", text: "That file isn't an OnBeat profile export, so nothing was imported." });
      return;
    }
    const told = learningTold();
    markLearningTold();
    let store: MemoryStore;
    let name: string;
    try {
      const profile = await registry.create(registry.uniqueName(parsed.name));
      name = profile.name;
      await registry.persistFor(profile.id).save({ version: 1, notes: parsed.notes, phrases: parsed.phrases });
      if (parsed.suggestions.length) await (await PendingStore.open(registry.keyValue, profile.id)).replaceAll(parsed.suggestions);
      store = await openProfileMemory(registry, profile.id);
    } catch {
      dispatch({ type: "notice", text: SAVE_FAILED });
      return;
    }
    setDemo(null);
    bumpProfiles();
    showMemory(store);
    dispatch({ type: "notice", text: told || !settings.learning ? `Imported ${name}.` : `Imported ${name}. ${LEARNING_NOTICE}` });
  };

  const deleteActive = async () => {
    const active = registry?.active();
    if (!registry || !active) return;
    await registry.remove(active.id);
    bumpProfiles();
    const next = registry.active();
    announce(`Deleted ${active.name}`);
    if (next) return switchTo(next.id);
    client?.cancel();
    if (state.speaking) stop();
    dispatch({ type: "reset" });
    setMemory(null);
    setView("setup");
  };

  const renameActive = async (name: string) => {
    const active = registry?.active();
    if (!registry || !active) return;
    await registry.rename(active.id, name);
    bumpProfiles();
  };

  const profiles = registry?.list() ?? [];
  const showMenu = view !== "loading" && (profiles.length > 0 || demo !== null);
  // Setup and the demo picker can go back only to something that is open.
  const back = memory ? () => setView("conversation") : undefined;

  return (
    <>
      <header className="mx-auto flex w-full max-w-[90rem] flex-wrap items-center justify-between gap-4 px-4 py-4 lg:px-8">
        <p className="text-2xl font-extrabold tracking-tight" translate="no">
          OnBeat
        </p>
        {showMenu && (
          <ProfileMenu
            profiles={profiles}
            activeId={registry?.active()?.id ?? null}
            demoName={demo?.name ?? null}
            onSwitch={(id) => void switchTo(id)}
            onNotes={() => leaveConversation("notes")}
            onNew={() => leaveConversation("setup")}
            onExport={exportActive}
            onImport={(file) => void importFile(file)}
            onRename={(name) => void renameActive(name)}
            onDelete={() => void deleteActive()}
            onDemo={() => leaveConversation("demo-picker")}
            suggestionCount={learning.suggestions.length}
            onSuggestions={() => leaveConversation("suggestions")}
          />
        )}
      </header>
      <main id="main" className="mx-auto w-full max-w-[90rem] px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] lg:px-8">
        <h1 className="sr-only">{view === "conversation" ? "Conversation" : "OnBeat"}</h1>
        {/* Always mounted, so screen readers hear the notice when its text changes. */}
        <div role="status">
          {registry && !registry.durable && (
            <p className="mb-4 rounded-control border-2 border-ink/30 px-4 py-3 text-body">Profiles and notes won&apos;t be saved in this window.</p>
          )}
          {state.notice && <p className="mb-4 rounded-control border-2 border-ink/30 px-4 py-3 text-body">{state.notice}</p>}
        </div>
        {demo && view === "conversation" && <DemoBar name={demo.name} onSetup={() => leaveConversation("setup")} />}
        {view === "setup" && (
          <ProfileSetup
            onDone={finishSetup}
            onDemo={() => setView("demo-picker")}
            onCancel={back}
            onImport={(file) => void importFile(file)}
          />
        )}
        {view === "demo-picker" && (
          <ProfilePicker personas={personas} onChoose={(p) => void startDemo(p)} onBack={back ?? (() => setView("setup"))} />
        )}
        {view === "notes" && memory && (
          <NotesEditor
            notes={notes}
            onSave={(note) => void saveNote(note)}
            onRemove={(id) => void removeNote(id)}
            onDone={() => {
              setView("conversation");
              resetFocusToTop();
            }}
          />
        )}
        {view === "suggestions" && memory && (
          <SuggestedNotes
            suggestions={learning.suggestions}
            notes={notes}
            onKeep={(s, draft) => void keepSuggestion(s, draft)}
            onSkip={(id) => {
              void learning.session?.pending.skip(id);
              announce("Skipped");
            }}
            onSkipAll={() => {
              void learning.session?.pending.skipAll();
              announce("Skipped all");
            }}
            onDone={() => {
              setView("conversation");
              resetFocusToTop();
            }}
          />
        )}
        <div className="conv-grid" hidden={conversationHidden}>
          <div className="flex flex-col gap-4 [grid-area:context]">
            <ContextBar
              places={places}
              people={people}
              placeId={state.placeId}
              partnerId={state.partnerId}
              onChange={(placeId, partnerId) => dispatch({ type: "setContext", placeId, partnerId })}
            />
            <ListenControl hearing={hearing} status={hearingStatus} progress={hearingProgress} onToggle={toggleListening} />
          </div>
          <div className="flex min-w-0 flex-col gap-6 [grid-area:log]">
            <CaptionLog turns={state.turns} partnerName={partnerName} partial={state.partnerPartial} />
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
            {showTimer && <ResponseGap gaps={gaps} />}
          </div>
        </div>
        <div className="mt-10 max-w-xl">
          <SettingsPanel
            theme={settings.theme}
            digitKeys={settings.digitKeys}
            cloudCaptions={settings.cloudCaptions}
            learning={settings.learning}
            onTheme={setTheme}
            onDigitKeys={setDigitKeys}
            onCloudCaptions={setCloudCaptions}
            onLearning={toggleLearning}
          />
        </div>
      </main>
    </>
  );
}
