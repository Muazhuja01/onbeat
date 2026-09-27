import type { Reaction } from "@/lib/language-packs/types";
import type { Reply, Turn } from "@/lib/types";

export type SuggestStatus = "idle" | "thinking" | "ready" | "paused";

export interface ConversationState {
  turns: Turn[];
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
  | { type: "typed"; text: string }
  | { type: "thinking" }
  | { type: "suggestions"; replies: Reply[]; reactions: Reaction[]; done: boolean; hold: boolean }
  | { type: "releaseHeld" }
  | { type: "unavailable" }
  | { type: "speakStart"; id: string; text: string; at: number }
  | { type: "speakEnd"; text: string }
  | { type: "notice"; text: string | null }
  | { type: "reset" };

export const PAUSED_NOTICE = "Suggestions are paused. Typing and speaking still work.";
const MAX_TURNS = 50;

export const initialConversation: ConversationState = {
  turns: [],
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
      return { ...state, turns: addTurn(state.turns, { id: action.id, speaker: "partner", text, at: action.at }) };
    }
    case "typed":
      return { ...state, typed: action.text };
    case "thinking":
      return {
        ...state,
        status: state.replies.length ? (state.status === "paused" ? "ready" : state.status) : "thinking",
        notice: state.notice === PAUSED_NOTICE ? null : state.notice,
      };
    case "suggestions": {
      const status = action.replies.length ? "ready" : action.done ? "idle" : state.status;
      if (action.hold && state.replies.length) {
        return { ...state, heldReplies: action.replies, reactions: action.reactions, status };
      }
      return { ...state, replies: action.replies, heldReplies: null, reactions: action.reactions, status };
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
    case "reset":
      return { ...initialConversation, placeId: state.placeId, partnerId: state.partnerId };
  }
}
