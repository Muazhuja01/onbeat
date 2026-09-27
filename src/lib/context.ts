import type { ConversationContext, Note, TimeOfDay } from "./types";

export function timeOfDay(d: Date): TimeOfDay {
  const h = d.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

function nameOf(note: Note | undefined): string | undefined {
  if (!note) return undefined;
  return note.entities[0] ?? note.text;
}

export function contextLine(
  ctx: ConversationContext,
  getNote: (id: string) => Note | undefined,
  locale = "en-US",
): string {
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(ctx.now);
  const parts = [`It is ${weekday} ${timeOfDay(ctx.now)}.`];
  const place = ctx.placeId ? nameOf(getNote(ctx.placeId)) : undefined;
  const partner = ctx.partnerId ? nameOf(getNote(ctx.partnerId)) : undefined;
  if (place) parts.push(`Place: ${place}.`);
  if (partner) parts.push(`Talking with: ${partner}.`);
  return parts.join(" ");
}
