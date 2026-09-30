import { z } from "zod";
import { NOTE_MAX } from "@/lib/profiles/notes";

export const ASSIST_USER_MAX = 20;
/** Every user line has at most one assistant line after it. */
export const ASSIST_LINES_MAX = ASSIST_USER_MAX * 2;
export const ASSIST_LINE_MAX = 600;
export const ASSIST_SAY_MAX = 400;
export const PHRASE_MAX = 120;
/** About 40 full notes; past this only related notes are sent (spec decision 22). */
export const ASSIST_NOTES_CHARS = 12_000;
export const ASSIST_NOTES_MAX = 200;
export const ASSIST_PHRASES_MAX = 100;
/** A dated note, a person, a place and five phrases. */
export const ASSIST_PROPOSALS_MAX = 8;

export type AssistJob = "update" | "prepare" | "phrases";

const Kind = z.enum(["person", "place", "routine", "preference", "about-me"]);
const Id = z.string().min(1).max(64);

export const AssistRequestSchema = z
  .object({
    job: z.enum(["update", "prepare", "phrases"]).nullable(),
    /** The user's local date, YYYY-MM-DD. */
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    lines: z
      .array(
        z.object({
          id: Id,
          speaker: z.enum(["user", "assistant"]),
          text: z.string().trim().min(1).max(ASSIST_LINE_MAX),
          /** For an assistant line: short descriptions of what it already offered. */
          proposed: z.array(z.string().max(NOTE_MAX + 40)).max(ASSIST_PROPOSALS_MAX).optional(),
        }),
      )
      .min(1)
      .max(ASSIST_LINES_MAX),
    notes: z.array(z.object({ id: Id, kind: Kind, text: z.string().max(NOTE_MAX) })).max(ASSIST_NOTES_MAX),
    phrases: z.array(z.object({ id: Id, text: z.string().max(PHRASE_MAX), for: z.string().max(80).optional() })).max(ASSIST_PHRASES_MAX),
  })
  .refine((r) => r.lines.at(-1)?.speaker === "user", "the last line is the user's")
  .refine((r) => r.lines.filter((l) => l.speaker === "user").length <= ASSIST_USER_MAX, "too many user lines")
  .refine((r) => r.notes.reduce((n, x) => n + x.text.length, 0) <= ASSIST_NOTES_CHARS, "notes over budget");

export type AssistRequest = z.infer<typeof AssistRequestSchema>;

const LineIds = z.array(z.string()).min(1).max(ASSIST_LINES_MAX);

export const AssistProposalSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), kind: Kind, name: z.string().max(60).optional(), text: z.string().min(1).max(NOTE_MAX), lineIds: LineIds }),
  z.object({ action: z.literal("edit"), kind: Kind, name: z.string().max(60).optional(), text: z.string().min(1).max(NOTE_MAX), noteId: z.string(), lineIds: LineIds }),
  z.object({ action: z.literal("remove"), noteId: z.string(), lineIds: LineIds }),
  z.object({ action: z.literal("phrase"), text: z.string().trim().min(1).max(PHRASE_MAX), for: z.string().max(80).optional(), lineIds: LineIds }),
]);

export type AssistProposal = z.infer<typeof AssistProposalSchema>;

export interface AssistResponse {
  say: string;
  proposals: AssistProposal[];
}
