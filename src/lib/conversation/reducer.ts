import type { Reaction } from "@/lib/language-packs/types";
import type { Reply, Turn } from "@/lib/types";

export type SuggestStatus = "idle" | "thinking" | "ready" | "paused";

export interface ConversationState {
  turns: Turn[];
  /** What the partner has said so far in the turn they are still speaking; "" when nobody is talking. */
  partnerPartial: string;
  /** True while those words carry on the last line after a short pause, so they will be added to it. */
  partialJoins: boolean;
  placeId?: string;
  partnerId?: string;
  typed: string;
  replies: Reply[];
  heldReplies: Reply[] | null;
  /** The reactions that came with heldReplies, shown with them. */
  heldReactions: Reaction[] | null;
  /** When the request behind `replies` was made (ms since epoch); null for the user's own phrase matches. */
  repliesAskedAt: number | null;
  heldAskedAt: number | null;
  reactions: Reaction[];
  status: SuggestStatus;
  speaking: string | null;
  lastSpoken: string | null;
  notice: string | null;
}

export type ConversationAction =
  | { type: "setContext"; placeId?: string; partnerId?: string }
  /**
   * `heard`: the line came from the microphone, with when this piece of speech started (if known) and ended.
   * `join`: the setting to keep the partner's pauses in one line is on.
   */
  | { type: "partnerSaid"; id: string; text: string; at: number; heard?: { startedAt?: number; endedAt: number }; join?: boolean }
  | { type: "partnerPartial"; text: string; startedAt?: number; join?: boolean }
  | { type: "typed"; text: string }
  | { type: "thinking"; speculative?: boolean }
  | { type: "suggestions"; replies: Reply[]; reactions: Reaction[]; done: boolean; hold: boolean; askedAt?: number }
  | { type: "releaseHeld" }
  | { type: "unavailable" }
  | { type: "speakStart"; id: string; text: string; at: number }
  | { type: "speakEnd"; text: string }
  | { type: "notice"; text: string | null }
  | { type: "reset" }
  | { type: "cancelled" };

export const PAUSED_NOTICE = "Suggestions are paused. Typing and speaking still work.";
const MAX_TURNS = 50;
/** Speech that starts this soon after the partner's last heard line ended carries that line on. */
export const JOIN_WINDOW_MS = 3000;

export const initialConversation: ConversationState = {
  turns: [],
  partnerPartial: "",
  partialJoins: false,
  typed: "",
  replies: [],
  heldReplies: null,
  heldReactions: null,
  repliesAskedAt: null,
  heldAskedAt: null,
  reactions: [],
  status: "idle",
  speaking: null,
  lastSpoken: null,
  notice: null,
};

function addTurn(turns: Turn[], turn: Turn): Turn[] {
  return [...turns, turn].slice(-MAX_TURNS);
}

/**
 * The line that speech starting at `startedAt` carries on: the last line, when the partner said it
 * and it was heard, not typed, and ended at most JOIN_WINDOW_MS before. Otherwise undefined.
 */
function lineToJoin(turns: Turn[], startedAt: number | undefined): Turn | undefined {
  const last = turns.at(-1);
  if (!last || last.speaker !== "partner" || last.endedAt === undefined || startedAt === undefined) return undefined;
  return startedAt - last.endedAt <= JOIN_WINDOW_MS ? last : undefined;
}

export function conversationReducer(state: ConversationState, action: ConversationAction): ConversationState {
  switch (action.type) {
    case "setContext":
      return { ...state, placeId: action.placeId, partnerId: action.partnerId };
    case "partnerSaid": {
      const text = action.text.trim();
      if (!text) return state;
      const { heard } = action;
      // They paused for a moment and carried on: the line grows in place and keeps its id.
      const joined = action.join && heard ? lineToJoin(state.turns, heard.startedAt) : undefined;
      if (joined && heard) {
        const grown = { ...joined, text: `${joined.text} ${text}`, endedAt: heard.endedAt };
        return { ...state, partnerPartial: "", partialJoins: false, turns: [...state.turns.slice(0, -1), grown] };
      }
      const turn = { id: action.id, speaker: "partner" as const, text, at: action.at, ...(heard ? { endedAt: heard.endedAt } : {}) };
      return { ...state, partnerPartial: "", partialJoins: false, turns: addTurn(state.turns, turn) };
    }
    case "partnerPartial": {
      const text = action.text.trim();
      return { ...state, partnerPartial: text, partialJoins: !!text && !!action.join && lineToJoin(state.turns, action.startedAt) !== undefined };
    }
    case "typed":
      return { ...state, typed: action.text };
    case "thinking":
      // While suggestions are paused, a speculative attempt changes nothing on
      // screen, so the notice isn't cleared and read out again every 2.5 s.
      if (action.speculative && state.status === "paused") return state;
      return {
        ...state,
        status: state.replies.length ? (state.status === "paused" ? "ready" : state.status) : "thinking",
        notice: state.notice === PAUSED_NOTICE ? null : state.notice,
      };
    case "suggestions": {
      const status = action.replies.length ? "ready" : action.done ? "idle" : state.status;
      const askedAt = action.askedAt ?? null;
      // Replies from the model mean suggestions work again.
      const notice = state.notice === PAUSED_NOTICE && action.replies.some((r) => r.source === "model") ? null : state.notice;
      // While the partner talks, a set still arriving doesn't replace a fuller one or empty
      // the reactions row, so the screen doesn't jump with each reply as it streams in.
      const arriving = !action.done && state.partnerPartial !== "";
      const reactions = arriving && action.reactions.length === 0 ? state.reactions : action.reactions;
      if (arriving && action.replies.length < state.replies.length) return { ...state, reactions, status, notice };
      if (action.hold && state.replies.length) {
        return { ...state, heldReplies: action.replies, heldReactions: reactions, heldAskedAt: askedAt, status, notice };
      }
      return { ...state, replies: action.replies, repliesAskedAt: askedAt, heldReplies: null, heldReactions: null, heldAskedAt: null, reactions, status, notice };
    }
    case "releaseHeld":
      return state.heldReplies
        ? {
            ...state,
            replies: state.heldReplies,
            reactions: state.heldReactions ?? state.reactions,
            repliesAskedAt: state.heldAskedAt,
            heldReplies: null,
            heldReactions: null,
            heldAskedAt: null,
          }
        : state;
    case "unavailable":
      return { ...state, status: "paused", notice: PAUSED_NOTICE };
    case "speakStart":
      return {
        ...state,
        speaking: action.text,
        lastSpoken: action.text,
        typed: state.typed.trim() === action.text.trim() ? "" : state.typed,
        turns: addTurn(state.turns, { id: action.id, speaker: "user", text: action.text, at: action.at }),
      };
    case "speakEnd":
      return state.speaking === action.text ? { ...state, speaking: null } : state;
    case "notice":
      return { ...state, notice: action.text };
    case "cancelled":
      // A request was cancelled (e.g. the typed text was cleared) before it
      // finished. Only a "thinking" status is stuck waiting on it; leave any
      // other status (ready, paused, idle) alone.
      return state.status === "thinking" ? { ...state, status: state.replies.length ? "ready" : "idle" } : state;
    case "reset":
      return { ...initialConversation, placeId: state.placeId, partnerId: state.partnerId };
  }
}
