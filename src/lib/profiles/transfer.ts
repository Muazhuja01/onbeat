import { z } from "zod";
import type { Note, Phrase } from "@/lib/types";
import { cleanName } from "./registry";

const NoteSchema = z.object({
  id: z.string(),
  kind: z.enum(["person", "place", "routine", "preference", "about-me"]),
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
});

const ExportSchema = z.object({
  format: z.literal("onbeat-profile"),
  version: z.literal(1),
  exportedAt: z.string(),
  profile: z.object({ name: z.string() }),
  notes: z.array(NoteSchema).max(5000),
  phrases: z.array(PhraseSchema).max(20000),
});

export function exportProfile(name: string, notes: Note[], phrases: Phrase[], now: Date): string {
  return JSON.stringify({ format: "onbeat-profile", version: 1, exportedAt: now.toISOString(), profile: { name }, notes, phrases }, null, 2);
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
export function parseImport(text: string): { name: string; notes: Note[]; phrases: Phrase[] } | null {
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
  return { name, notes, phrases };
}
