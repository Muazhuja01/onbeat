export type NoteKind = "person" | "place" | "routine" | "preference" | "about-me";

export interface Note {
  id: string;
  kind: NoteKind;
  text: string;
  /** Proper names in the note, e.g. ["Sam", "Blue Door Café"]. */
  entities: string[];
  updatedAt: number;
  /** Always sent with suggestion requests: the note that says who the user is and how they communicate. */
  pinned?: boolean;
}

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export interface Phrase {
  id: string;
  text: string;
  context: { placeId?: string; partnerId?: string; timeOfDay: TimeOfDay };
  timesUsed: number;
  lastUsed: number;
  /** Made on purpose (in the assistant or Your notes), shown in the "Your phrases" row. Everyday spoken phrases never have it. */
  quick?: true;
}

export interface ConversationContext {
  now: Date;
  /** Id of a note of kind "place". */
  placeId?: string;
  /** Id of a note of kind "person". */
  partnerId?: string;
}

export interface Turn {
  id: string;
  speaker: "partner" | "user";
  text: string;
  at: number;
  /** Lines heard through the microphone: when the partner's last word ended (ms since epoch). Typed lines have none. */
  endedAt?: number;
}

export interface Reply {
  text: string;
  noteIds: string[];
  source: "model" | "phrase";
}
