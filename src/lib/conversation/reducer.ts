import type { Reaction } from "@/lib/language-packs/types";
import type { Reply, Turn } from "@/lib/types";

export type SuggestStatus = "idle" | "thinking" | "ready" | "paused";

export interface ConversationState {
  turns: Turn[];
  /** What the partner has said so far in the turn they are still speaking; "" when nobody is talking. */
  partnerPartial: string;
  placeId?: string;
  partnerId?: string;
  typed: string;
  replies: Reply[];
  heldReplies: Reply[] | null;
  reactions: Reaction[];
  status: SuggestStatus;
  speaking: string | null;
  lastSpoken: string | null;
  notice: string | null;
}

export type ConversationAction =
  | { type: "setContext"; placeId?: string; partnerId?: string }
  | { type: "partnerSaid"; id: string; text: string; at: number }
  | { type: "partnerPartial"; text: string }
  | { type: "typed"; text: string }
  | { type: "thinking"; speculative?: boolean }
  | { type: "suggestions"; replies: Reply[]; reactions: Reaction[]; done: boolean; hold: boolean }
  | { type: "releaseHeld" }
  | { type: "unavailable" }
  | { type: "speakStart"; id: string; text: string; at: number }
  | { type: "speakEnd"; text: string }
  | { type: "notice"; text: string | null }
  | { type: "reset" }
  | { type: "cancelled" };

export const PAUSED_NOTICE = "Suggestions are paused. Typing and speaking still work.";
const MAX_TURNS = 50;

export const initialConversation: ConversationState = {
  turns: [],
  partnerPartial: "",
  typed: "",
  replies: [],
  heldReplies: null,
  reactions: [],
  status: "idle",
  speaking: null,
  lastSpoken: null,
  notice: null,
};

function addTurn(turns: Turn[], turn: Turn): Turn[] {
  return [...turns, turn].slice(-MAX_TURNS);
}

export function conversationReducer(state: ConversationState, action: ConversationAction): ConversationState {
  switch (action.type) {
    case "setContext":
      return { ...state, placeId: action.placeId, partnerId: action.partnerId };
    case "partnerSaid": {
      const text = action.text.trim();
      if (!text) return state;
      return { ...state, partnerPartial: "", turns: addTurn(state.turns, { id: action.id, speaker: "partner", text, at: action.at }) };
    }
    case "partnerPartial":
      return { ...state, partnerPartial: action.text.trim() };
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
      // Replies from the model mean suggestions work again.
      const notice = state.notice === PAUSED_NOTICE && action.replies.some((r) => r.source === "model") ? null : state.notice;
      if (action.hold && state.replies.length) {
        return { ...state, heldReplies: action.replies, reactions: action.reactions, status, notice };
      }
      return { ...state, replies: action.replies, heldReplies: null, reactions: action.reactions, status, notice };
    }
    case "releaseHeld":
      return state.heldReplies ? { ...state, replies: state.heldReplies, heldReplies: null } : state;
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
