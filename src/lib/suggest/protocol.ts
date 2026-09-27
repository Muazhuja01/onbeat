import { z } from "zod";

export const SuggestRequestSchema = z.object({
  mode: z.enum(["replies", "replies+reactions"]),
  typed: z.string().max(500),
  partnerSaid: z.string().max(1000),
  contextLine: z.string().max(300),
  notes: z.array(z.object({ id: z.string().max(64), text: z.string().max(300) })).max(12),
  examples: z.array(z.string().max(200)).max(5),
  reactions: z.array(z.object({ id: z.string().max(32), text: z.string().max(60) })).max(30),
  maxWords: z.number().int().min(5).max(25),
  preferProvider: z.enum(["groq", "cloudflare"]).optional(),
});

export type SuggestRequestBody = z.infer<typeof SuggestRequestSchema>;

const ReplyLine = z.object({ reply: z.string().min(1).max(200), notes: z.array(z.string()).default([]) });
const ReactionsLine = z.object({ reactions: z.array(z.string()).max(4) });

export type ParsedLine =
  | { kind: "reply"; text: string; noteIds: string[] }
  | { kind: "reactions"; ids: string[] }
  | { kind: "invalid"; raw: string };

export function parseLine(raw: string): ParsedLine | null {
  const line = raw.trim();
  if (!line) return null;
  if (!line.startsWith("{")) return { kind: "invalid", raw: line };
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return { kind: "invalid", raw: line };
  }
  const reply = ReplyLine.safeParse(json);
  if (reply.success) return { kind: "reply", text: reply.data.reply.trim(), noteIds: reply.data.notes };
  const reactions = ReactionsLine.safeParse(json);
  if (reactions.success) return { kind: "reactions", ids: reactions.data.reactions };
  return { kind: "invalid", raw: line };
}

export function createLineSplitter(onLine: (line: string) => void) {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf("\n")) >= 0) {
        onLine(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
      }
    },
    flush() {
      if (buffer.trim()) onLine(buffer);
      buffer = "";
    },
  };
}
