import { z } from "zod";
import type { PendingSuggestion } from "@/lib/learning/types";
import type { Note, Phrase } from "@/lib/types";
import { DEFAULT_VOICE, migrateChoice, type VoiceChoice } from "@/lib/voice/choices";
import { cleanName } from "./registry";

const Kind = z.enum(["person", "place", "routine", "preference", "about-me"]);

const NoteSchema = z.object({
  id: z.string(),
  kind: Kind,
  text: z.string().max(2000),
  entities: z.array(z.string().max(200)).max(50),
  updatedAt: z.number(),
  pinned: z.boolean().optional(),
});

const PhraseSchema = z.object({
  id: z.string(),
  text: z.string().max(2000),
  context: z.object({
    placeId: z.string().optional(),
    partnerId: z.string().optional(),
    timeOfDay: z.enum(["morning", "afternoon", "evening", "night"]),
  }),
  timesUsed: z.number(),
  lastUsed: z.number(),
  // zod drops keys it doesn't list, so without this an import would lose the flag.
  quick: z.literal(true).optional(),
});

const SuggestionSchema = z.object({
  id: z.string(),
  action: z.enum(["add", "edit"]),
  draft: z.object({ kind: Kind, name: z.string().max(200).optional(), text: z.string().max(2000) }),
  noteId: z.string().optional(),
  oldText: z.string().max(2000).optional(),
  sources: z
    .array(z.object({ speaker: z.enum(["user", "partner"]), text: z.string().max(2000), at: z.number(), partnerName: z.string().max(200).optional() }))
    .max(40),
  createdAt: z.number(),
});

const ExportSchema = z.object({
  format: z.literal("onbeat-profile"),
  version: z.literal(1),
  exportedAt: z.string(),
  profile: z.object({ name: z.string(), voice: z.unknown().optional() }),
  notes: z.array(NoteSchema).max(5000),
  phrases: z.array(PhraseSchema).max(20000),
  suggestions: z.array(SuggestionSchema).max(30).optional(),
});

export function exportProfile(name: string, notes: Note[], phrases: Phrase[], now: Date, suggestions: PendingSuggestion[] = [], voice?: VoiceChoice): string {
  return JSON.stringify({ format: "onbeat-profile", version: 1, exportedAt: now.toISOString(), profile: { name, ...(voice ? { voice } : {}) }, notes, phrases, suggestions }, null, 2);
}

export function exportFileName(name: string, now: Date): string {
  const slug =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "profile";
  return `onbeat-${slug}-${now.toISOString().slice(0, 10)}.json`;
}

/** Reads an export. Ids are made new so importing one file twice never mixes two profiles. */
export function parseImport(text: string): { name: string; notes: Note[]; phrases: Phrase[]; suggestions: PendingSuggestion[]; voice: VoiceChoice } | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = ExportSchema.safeParse(data);
  if (!parsed.success) return null;
  const name = cleanName(parsed.data.profile.name);
  if (!name) return null;

  const ids = new Map(parsed.data.notes.map((n) => [n.id, `n_${crypto.randomUUID()}`]));
  const notes: Note[] = parsed.data.notes.map((n) => ({ ...n, id: ids.get(n.id)! }));
  const phrases: Phrase[] = parsed.data.phrases.map((p) => ({
    ...p,
    id: `p_${crypto.randomUUID()}`,
    context: {
      timeOfDay: p.context.timeOfDay,
      placeId: p.context.placeId ? ids.get(p.context.placeId) : undefined,
      partnerId: p.context.partnerId ? ids.get(p.context.partnerId) : undefined,
    },
  }));
  // A suggested edit follows its note to the note's new id; if the note isn't in the file, it becomes a new note.
  const suggestions: PendingSuggestion[] = (parsed.data.suggestions ?? []).map((s) => {
    const noteId = s.noteId ? ids.get(s.noteId) : undefined;
    return {
      id: `s_${crypto.randomUUID()}`,
      action: noteId ? "edit" : "add",
      draft: s.draft,
      ...(noteId ? { noteId, ...(s.oldText ? { oldText: s.oldText } : {}) } : {}),
      sources: s.sources,
      createdAt: s.createdAt,
    };
  });
  const given = parsed.data.profile.voice;
  // Rebuilt field by field, so nothing else in the file is stored with the profile.
  const voice: VoiceChoice = migrateChoice(given) ?? DEFAULT_VOICE;
  return { name, notes, phrases, suggestions, voice };
}
