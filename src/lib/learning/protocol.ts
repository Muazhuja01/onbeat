import { z } from "zod";
import { NOTE_MAX } from "@/lib/profiles/notes";

export const LEARN_LINES_MAX = 40;
export const LEARN_LINE_MAX = 500;
/** The pinned about-me note plus up to 8 related notes. */
export const LEARN_NOTES_MAX = 9;
export const PROPOSALS_MAX = 5;

const Kind = z.enum(["person", "place", "routine", "preference", "about-me"]);

export const LearnRequestSchema = z.object({
  /** The user's local date, YYYY-MM-DD, so dates in notes match their calendar. */
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        speaker: z.enum(["user", "partner"]),
        text: z.string().trim().min(1).max(LEARN_LINE_MAX),
        partnerName: z.string().max(60).optional(),
        placeName: z.string().max(80).optional(),
      }),
    )
    .min(1)
    .max(LEARN_LINES_MAX),
  notes: z.array(z.object({ id: z.string().min(1).max(64), kind: Kind, text: z.string().max(NOTE_MAX) })).max(LEARN_NOTES_MAX),
});

export type LearnRequest = z.infer<typeof LearnRequestSchema>;

export const ProposalSchema = z.object({
  action: z.enum(["add", "edit"]),
  kind: Kind,
  name: z.string().max(60).optional(),
  text: z.string().min(1).max(NOTE_MAX),
  noteId: z.string().optional(),
  lineIds: z.array(z.string()).min(1).max(LEARN_LINES_MAX),
});

export type Proposal = z.infer<typeof ProposalSchema>;
