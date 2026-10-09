"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { personas, type Persona } from "@/data/personas";
import { ASSISTANT_ENABLED } from "@/lib/assist/enabled";
import { conversationReducer, initialConversation } from "@/lib/conversation/reducer";
import { GapTimer, loadGaps, saveGap } from "@/lib/conversation/response-gap";
import { useReplyShortcuts } from "@/lib/conversation/use-shortcuts";
import { useMedia, WIDE } from "@/lib/use-media";
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
import { ProfileRegistry, profileVoice } from "@/lib/profiles/registry";
import { exportFileName, exportProfile, parseImport } from "@/lib/profiles/transfer";
import { getServerSettings, getSettings, learningTold, markLearningTold, setCloudCaptions, setDigitKeys, setJoinLines, setLearning, setTheme, subscribeSettings } from "@/lib/settings";
import { SuggestClient } from "@/lib/suggest/client";
import type { Note } from "@/lib/types";
import { getBrowserVoice, setCurrentVoice } from "@/lib/voice/browser";
import { describeVoice, speedValue, voiceId, type VoiceChoice } from "@/lib/voice/choices";
import type { VoiceEngine, VoiceMode } from "@/lib/voice/engine";
import type { VoiceSource } from "@/lib/voice/messages";
import { AnnouncerProvider, useAnnounce } from "./announcer";
import { Composer } from "./composer";
import { ContextButton, ContextChips } from "./context-bar";
import { DemoChip } from "./demo-chip";
import { Notice } from "./notice-banner";
import { ListenControl } from "./listen-control";
import { AssistantScreen, type AssistantHandle } from "./assistant-screen";
import { NotesEditor } from "./notes-editor";
import { ProfileMenu } from "./profile-menu";
import { ProfilePicker } from "./profile-picker";
import { ProfileSetup } from "./profile-setup";
import { PhraseRow } from "./phrase-row";
import { ReactionBar } from "./reaction-bar";
import { ReplyList } from "./reply-list";
import { SettingsButton, SettingsDrawer } from "./settings-drawer";
import { ResponseGap } from "./response-gap";
import { SuggestedNotes } from "./suggested-notes";
import { VoiceScreen } from "./voice-picker";
import { TheySaidButton, TheySaidForm } from "./they-said";
import { Thread } from "./thread";
import { TopBar } from "./top-bar";
import { Tray } from "./tray";
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
type View = "loading" | "setup" | "demo-picker" | "notes" | "suggestions" | "voice" | "assistant" | "conversation";

const SAVE_FAILED = "Couldn't save. Your browser's storage may be full.";
const LEARNING_NOTICE = "New: OnBeat can suggest notes from your conversations for you to review. Turn it off in Settings.";
const VOICE_BACKUP = "Said in the backup voice: yours wasn't ready in time.";
const VOICE_FALLBACK = "Said in your device's voice: yours wasn't ready in time.";

function Screen() {
  const announce = useAnnounce();
  const [registry, setRegistry] = useState<ProfileRegistry | null>(null);
  // The registry is mutable; this counter re-renders after it changes.
  const [profilesVersion, setProfilesVersion] = useState(0);
  const [view, setView] = useState<View>("loading");
  const [demo, setDemo] = useState<Persona | null>(null);
  const [memory, setMemory] = useState<MemoryStore | null>(null);
  const [notesVersion, setNotesVersion] = useState(0);
  const [voiceProgress, setVoiceProgress] = useState(0);
  /** On while a line waits for its clip in the chosen voice. */
  const [voiceWaiting, setVoiceWaiting] = useState(false);
  const [state, dispatch] = useReducer(conversationReducer, initialConversation);
  const wide = useMedia(WIDE);
  const [theySaidOpen, setTheySaidOpen] = useState(false);
  /** Set when "+ They said" closes, so focus goes back to the reply box once it is shown again. */
  const refocusComposer = useRef(false);
  useEffect(() => {
    if (theySaidOpen || !refocusComposer.current) return;
    refocusComposer.current = false;
    document.getElementById("composer")?.focus();
  }, [theySaidOpen]);
  const closeTheySaid = () => {
    refocusComposer.current = true;
    setTheySaidOpen(false);
  };
  /** The "won't be saved in this window" notice, once read and dismissed. */
  const [unsavedDismissed, setUnsavedDismissed] = useState(false);

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
  const subscribeSource = useCallback((cb: () => void) => (voice ? voice.on("source", cb) : () => {}), [voice]);
  const voiceSource = useSyncExternalStore<VoiceSource>(subscribeSource, () => voice?.source ?? "waking", () => "waking");
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
      voice.on("waiting", setVoiceWaiting),
      voice.on("fallback", (text) => dispatch({ type: "lineNote", text, note: VOICE_FALLBACK })),
      voice.on("backup", (text) => dispatch({ type: "lineNote", text, note: VOICE_BACKUP })),
    ];
    voice.load();
    return () => offs.forEach((off) => off());
  }, [voice]);

  // The microphone would hear the app's own voice: pause while it speaks and a moment after.
  // Listening carries on under the setup and voice views, where samples play.
  useEffect(() => {
    if (!voice || !hearing) return;
    const pause = () => hearing.pause();
    const resume = () => hearing.resume(400);
    // While a line waits for the chosen voice nothing is playing, so the other person is still heard.
    const waiting = (on: boolean) => (on ? hearing.resume(0) : hearing.pause());
    const offs = [
      voice.on("start", pause),
      voice.on("waiting", waiting),
      voice.on("end", resume),
      voice.on("sampleStart", pause),
      voice.on("sampleEnd", resume),
    ];
    return () => offs.forEach((off) => off());
  }, [voice, hearing]);

  useEffect(() => {
    if (!hearing) return;
    // When the speech being heard started, so the reducer can tell whether it carries the last line on.
    let speechStartedAt: number | undefined;
    // The setting is read at each event, so turning it off stops joining straight away.
    const offs = [
      hearing.on("progress", setHearingProgress),
      hearing.on("speechStart", (at) => {
        speechStartedAt = at;
        gapTimer.speechStarted(at);
      }),
      hearing.on("partial", (text) => dispatch({ type: "partnerPartial", text, startedAt: speechStartedAt, join: getSettings().joinLines })),
      hearing.on("turnEnd", ({ text, startedAt, endedAt }) => {
        speechStartedAt = undefined;
        dispatch({ type: "partnerSaid", id: crypto.randomUUID(), text, at: Date.now(), heard: { startedAt, endedAt }, join: getSettings().joinLines });
        gapTimer.turnEnded(endedAt);
      }),
      hearing.on("turnRevised", ({ from, to }) => dispatch({ type: "partnerRevised", from, to })),
    ];
    return () => {
      offs.forEach((off) => off());
      hearing.stop();
    };
  }, [hearing, gapTimer]);

  const client = useMemo(() => (memory ? new SuggestClient({ memory, pack: en }) : null), [memory]);

  const activeProfileId = demo ? null : (registry?.active()?.id ?? null);

  // Every spoken line uses the open profile's (or demo's) voice.
  const currentChoice = demo ? demo.voice : profileVoice(registry?.active());
  const voiceKey = `${voiceId(currentChoice)}|${speedValue(currentChoice)}`;
  useEffect(() => {
    setCurrentVoice(demo ? demo.voice : profileVoice(registry?.active()));
  }, [demo, activeProfileId, profilesVersion, registry]);
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

  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Runs once the settings drawer has closed, so a screen it opens gets focus after the drawer gives it back. */
  const afterSettings = useRef<(() => void) | null>(null);
  const closeSettings = () => {
    setSettingsOpen(false);
    const next = afterSettings.current;
    afterSettings.current = null;
    next?.();
  };
  const replyListRef = useRef<HTMLElement>(null);
  const releaseHeld = useCallback(() => dispatch({ type: "releaseHeld" }), []);
  const isHolding = useStableTargets(replyListRef, releaseHeld);
  useSuggestions({ client, memory, state, dispatch, isHolding });

  useEffect(() => {
    if (!voice) return;
    voice.prepareReplies(state.replies.map((r) => r.text));
    // A changed voice makes the prepared clips the wrong ones: prepare them again (after the current-voice effect above).
  }, [voice, state.replies, voiceKey]);

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
    (text: string, opts?: { isReaction?: boolean; quick?: boolean }) => {
      const t = text.trim();
      if (!t || !voice) return;
      void voice.speak(t);
      // A quick reaction (e.g. "Thanks!") isn't a phrase the user composed;
      // saving it would pollute their saved phrases.
      if (opts?.isReaction) return;
      // A reply tapped as it is came from the notes, maybe with an invented detail, and a
      // quick phrase was made on purpose: only the user's own new words are learned from.
      if (!opts?.quick && !state.replies.some((r) => r.text.trim() === t)) void learning.session?.addLine({ speaker: "user", text: t, ...lineContext() });
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
    // The first reply, not a quick reaction or phrase above it.
    replyListRef.current?.querySelector<HTMLButtonElement>("ol button")?.focus();
  }, []);

  const notes = useMemo(() => (memory ? memory.notes() : []), [memory, notesVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const [phrasesVersion, setPhrasesVersion] = useState(0);
  const quickPhrases = useMemo(
    () => (memory ? memory.quickPhrases({ partnerId: state.partnerId, placeId: state.placeId }) : []),
    [memory, state.partnerId, state.placeId, notesVersion, phrasesVersion], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const places = notes.filter((n) => n.kind === "place");
  const people = notes.filter((n) => n.kind === "person");
  const partnerName = (state.partnerId && memory?.getNote(state.partnerId)?.entities[0]) || "Them";
  // The conversation view stays mounted (useStableTargets attaches to the reply
  // list once, on mount); it is only hidden while another view is showing.
  const conversationHidden = memory === null || view !== "conversation";
  // Once someone has spoken, the reactions row and reply list keep their room so the screen stays still.
  const conversationStarted = state.turns.length > 0 || state.partnerPartial !== "";

  // Each new line from the partner is announced. A line that grew (they carried on
  // after a pause) keeps its id, and only the new words are read out. A line corrected
  // by cloud captions isn't read out again.
  const lastPartnerTurn = state.turns.findLast((t) => t.speaker === "partner");
  const announcedTurn = useRef<{ id: string; text: string } | null>(null);
  useEffect(() => {
    if (!lastPartnerTurn) return;
    const before = announcedTurn.current;
    if (before?.id === lastPartnerTurn.id && before.text === lastPartnerTurn.text) return;
    announcedTurn.current = { id: lastPartnerTurn.id, text: lastPartnerTurn.text };
    const grew = before?.id === lastPartnerTurn.id && lastPartnerTurn.text.startsWith(before.text);
    if (before?.id === lastPartnerTurn.id && !grew) return;
    announce(`${partnerName} said: ${grew ? lastPartnerTurn.text.slice(before.text.length).trim() : lastPartnerTurn.text}`);
  }, [lastPartnerTurn, partnerName, announce]);

  // Each line from the partner goes to learning once. A line that grew, or was corrected
  // by cloud captions, updates what was queued for it rather than being learned again.
  const learnedTurns = useRef(new Map<string, string>());
  useEffect(() => {
    for (const turn of state.turns) {
      if (turn.speaker !== "partner") continue;
      const before = learnedTurns.current.get(turn.id);
      if (before === turn.text) continue;
      learnedTurns.current.set(turn.id, turn.text);
      const line = { id: turn.id, speaker: "partner" as const, text: turn.text, ...lineContext() };
      if (before === undefined) void learning.session?.addLine(line);
      else if (turn.text.startsWith(before)) void learning.session?.growLine(line, turn.text.slice(before.length).trim());
      else void learning.session?.reviseLine(line);
    }
  }, [state.turns, learning.session, lineContext]);

  // Profiles made before learning existed are told once, the first time they open.
  useEffect(() => {
    if (!memory || demo || view !== "conversation" || !settings.learning || learningTold()) return;
    markLearningTold();
    dispatch({ type: "notice", text: LEARNING_NOTICE });
  }, [memory, demo, view, settings.learning]);

  useReplyShortcuts({
    enabled: !conversationHidden && !settingsOpen,
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

  /**
   * A screen picked from the menu. From the assistant it goes through the assistant's
   * "Leave without keeping N changes?" (spec decision 4); only switching profile skips it.
   */
  const assistantRef = useRef<AssistantHandle>(null);
  const goTo = (next: View) => {
    if (view === "assistant" && assistantRef.current) assistantRef.current.requestLeave(() => leaveConversation(next));
    else leaveConversation(next);
  };

  /** The assistant covers the conversation: stop listening and speech first. */
  const openAssistant = () => {
    hearing?.stop();
    gapTimer.reset();
    leaveConversation("assistant");
  };

  /** Clears the screen for the next conversation; who, where and listening stay as they are. */
  const newConversation = () => {
    // Like a profile switch: a late reply for the old conversation must never appear.
    client?.cancel();
    if (state.speaking) stop();
    dispatch({ type: "reset" });
    gapTimer.reset();
    learning.session?.conversationEnded();
    announce("Conversation cleared.");
    if (theySaidOpen) closeTheySaid();
    else document.getElementById("composer")?.focus();
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

  const finishSetup = async (name: string, made: Note[], voiceChoice: VoiceChoice) => {
    if (!registry) return;
    let store: MemoryStore;
    try {
      const profile = await registry.create(name, voiceChoice);
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
    // Only once the new profile has opened, before anything can be spoken for it; the
    // current-voice effect keeps it in step afterwards.
    setCurrentVoice(profileVoice(registry.active()));
    setDemo(null);
    bumpProfiles();
    showMemory(store);
  };

  const startDemo = async (persona: Persona) => {
    const store = await openDemoMemory(persona);
    setCurrentVoice(persona.voice);
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
    const url = URL.createObjectURL(new Blob([exportProfile(active.name, memory.notes(), memory.phrases(), now, learning.suggestions, profileVoice(active))], { type: "application/json" }));
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
      const profile = await registry.create(registry.uniqueName(parsed.name), parsed.voice);
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

  const activeProfile = demo ? null : (registry?.active() ?? null);
  const activeVoice = activeProfile ? profileVoice(activeProfile) : null;
  // Settings offers the voice only on the conversation: on setup it would show the old
  // profile's voice, and changing it would lose what was typed.
  const settingsVoice = view === "conversation" ? activeVoice : null;
  const saveVoice = async (choice: VoiceChoice) => {
    if (!registry || !activeProfile) return;
    try {
      await registry.setVoice(activeProfile.id, choice);
    } catch {
      dispatch({ type: "notice", text: SAVE_FAILED });
      return;
    }
    setCurrentVoice(choice);
    bumpProfiles();
    announce("Voice saved");
    setView("conversation");
    resetFocusToTop();
  };

  const profiles = registry?.list() ?? [];
  const showMenu = view !== "loading" && (profiles.length > 0 || demo !== null);
  // Setup and the demo picker can go back only to something that is open.
  const back = memory ? () => setView("conversation") : undefined;

  const inConversation = !conversationHidden;
  const contextProps = {
    places,
    people,
    placeId: state.placeId,
    partnerId: state.partnerId,
    onChange: (placeId?: string, partnerId?: string) => dispatch({ type: "setContext", placeId, partnerId }),
  };
  const listen = <ListenControl hearing={hearing} status={hearingStatus} progress={hearingProgress} onToggle={toggleListening} />;
  const openTheySaid = () => setTheySaidOpen(true);

  return (
    <div className={inConversation ? "flex h-dvh flex-col" : undefined}>
      <TopBar
        start={
          inConversation && wide ? (
            <>
              <ContextChips {...contextProps} />
              {listen}
            </>
          ) : undefined
        }
        end={
          <>
            {inConversation && !wide && listen}
            {demo && inConversation && wide && <DemoChip name={demo.name} onSetup={() => leaveConversation("setup")} />}
            {showMenu && (
              <ProfileMenu
                profiles={profiles}
                activeId={registry?.active()?.id ?? null}
                demoName={demo?.name ?? null}
                onSwitch={(id) => void switchTo(id)}
                onNotes={() => goTo("notes")}
                voiceLabel={activeVoice ? describeVoice(activeVoice) : undefined}
                onVoice={activeVoice ? () => goTo("voice") : undefined}
                onNew={() => goTo("setup")}
                onExport={exportActive}
                onImport={(file) => void importFile(file)}
                onRename={(name) => void renameActive(name)}
                onDelete={() => void deleteActive()}
                onDemo={() => goTo("demo-picker")}
                suggestionCount={learning.suggestions.length}
                onSuggestions={() => goTo("suggestions")}
                onAssistant={demo || !ASSISTANT_ENABLED ? undefined : openAssistant}
                compact={!wide}
                onSettings={wide ? undefined : () => setSettingsOpen(true)}
              />
            )}
            {(wide || !showMenu) && <SettingsButton onOpen={() => setSettingsOpen(true)} />}
          </>
        }
        below={
          inConversation && !wide ? (
            <div className="px-4 pb-3">
              <ContextButton {...contextProps} />
            </div>
          ) : undefined
        }
      />
      <main
        id="main"
        className={
          inConversation
            ? "flex min-h-0 flex-1 flex-col overflow-y-auto"
            : "mx-auto w-full max-w-[90rem] px-4 py-6 pb-[calc(env(safe-area-inset-bottom)+2rem)] lg:px-8"
        }
      >
        <h1 className="sr-only">{view === "conversation" ? "Conversation" : "OnBeat"}</h1>
        {/* Always mounted, so screen readers hear a notice when its text changes. */}
        <div role="status" className={`mx-auto flex w-full max-w-[54rem] flex-col gap-2 empty:hidden ${inConversation ? "px-4 pt-3" : "pb-4"}`}>
          {registry && !registry.durable && !unsavedDismissed && (
            <Notice text="Profiles and notes won't be saved in this window." onDismiss={() => setUnsavedDismissed(true)} />
          )}
          {state.notice && <Notice text={state.notice} onDismiss={() => dispatch({ type: "notice", text: null })} />}
        </div>
        {view === "setup" && (
          <ProfileSetup
            onDone={finishSetup}
            onDemo={() => setView("demo-picker")}
            onCancel={back}
            onImport={(file) => void importFile(file)}
            voice={voice}
            voiceMode={voiceMode}
            voiceProgress={voiceProgress}
          />
        )}
        {view === "demo-picker" && (
          <ProfilePicker personas={personas} onChoose={(p) => void startDemo(p)} onBack={back ?? (() => setView("setup"))} />
        )}
        {view === "assistant" && memory && !demo && (
          <AssistantScreen
            ref={assistantRef}
            key={activeProfileId ?? "none"}
            memory={memory}
            announce={announce}
            onChanged={() => {
              // Notes or phrases changed: cached replies are stale (R13), and a removed note may be the current Talking with or Place.
              client?.clearCache();
              setNotesVersion((v) => v + 1);
              setPhrasesVersion((v) => v + 1);
              if ((state.partnerId && !memory.getNote(state.partnerId)) || (state.placeId && !memory.getNote(state.placeId))) {
                dispatch({
                  type: "setContext",
                  partnerId: state.partnerId && memory.getNote(state.partnerId) ? state.partnerId : undefined,
                  placeId: state.placeId && memory.getNote(state.placeId) ? state.placeId : undefined,
                });
              }
            }}
            onClose={() => {
              setView("conversation");
              resetFocusToTop();
            }}
          />
        )}
        {view === "notes" && memory && (
          <NotesEditor
            notes={notes}
            onSave={(note) => void saveNote(note)}
            onRemove={(id) => void removeNote(id)}
            phrases={memory.allQuickPhrases()}
            onAddPhrase={async (text, tie) => {
              const made = await memory.addQuickPhrase(text, tie);
              setPhrasesVersion((v) => v + 1);
              if (made) announce("Phrase saved");
              return made !== null;
            }}
            onUpdatePhrase={async (id, text, tie) => {
              const ok = await memory.updateQuickPhrase(id, text, tie);
              setPhrasesVersion((v) => v + 1);
              if (ok) announce("Phrase saved");
              return ok;
            }}
            onRemovePhrase={(id) =>
              void memory.removePhrase(id).then(() => {
                setPhrasesVersion((v) => v + 1);
                announce("Phrase deleted");
              })
            }
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
        {view === "voice" && activeProfile && activeVoice && (
          <VoiceScreen
            initial={activeVoice}
            name={activeProfile.name}
            voice={voice}
            mode={voiceMode}
            progress={voiceProgress}
            onSave={(v) => void saveVoice(v)}
            onCancel={() => {
              setView("conversation");
              resetFocusToTop();
            }}
          />
        )}
        <div className="mx-auto flex min-h-0 w-full max-w-[54rem] flex-1 flex-col gap-3 px-4 pt-3 lg:pb-4" hidden={conversationHidden}>
          <Thread
            turns={state.turns}
            partnerName={partnerName}
            partial={state.partnerPartial}
            speaking={state.speaking}
            waiting={voiceWaiting}
            lineNotes={state.lineNotes}
            onStop={stop}
            onNewConversation={newConversation}
            footer={!wide && !theySaidOpen ? <TheySaidButton pill onOpen={openTheySaid} /> : undefined}
          />
          <Tray>
            <ReplyList
              ref={replyListRef}
              replies={state.replies}
              reserve={conversationStarted}
              speaking={state.speaking}
              status={state.status}
              onSpeak={speak}
              onStop={stop}
              aside={<ReactionBar reactions={state.reactions} reserve={conversationStarted} onReact={(text) => speak(text, { isReaction: true })} />}
              below={<PhraseRow phrases={quickPhrases} onSpeak={(text) => speak(text, { quick: true })} />}
            />
            {theySaidOpen && (
              <TheySaidForm onSubmit={(text) => dispatch({ type: "partnerSaid", id: crypto.randomUUID(), text, at: Date.now() })} onClose={closeTheySaid} />
            )}
            <div hidden={theySaidOpen}>
              <Composer
                value={state.typed}
                onChange={(text) => dispatch({ type: "typed", text })}
                onSpeak={speak}
                onFocusReplies={focusReplies}
                before={wide ? <TheySaidButton onOpen={openTheySaid} /> : undefined}
              />
            </div>
            <VoiceStatus mode={voiceMode} source={voiceSource} progress={voiceProgress} />
            {showTimer && <ResponseGap gaps={gaps} />}
          </Tray>
        </div>
      </main>
      <SettingsDrawer
        open={settingsOpen}
        onClose={closeSettings}
        theme={settings.theme}
        digitKeys={settings.digitKeys}
        cloudCaptions={settings.cloudCaptions}
        learning={settings.learning}
        joinLines={settings.joinLines}
        voiceLabel={settingsVoice ? describeVoice(settingsVoice) : undefined}
        voiceBasic={voiceMode === "basic"}
        onVoice={
          settingsVoice
            ? () => {
                afterSettings.current = () => leaveConversation("voice");
                setSettingsOpen(false);
              }
            : undefined
        }
        onTheme={setTheme}
        onDigitKeys={setDigitKeys}
        onCloudCaptions={setCloudCaptions}
        onLearning={toggleLearning}
        onJoinLines={setJoinLines}
      />
    </div>
  );
}
