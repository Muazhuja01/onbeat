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

/**
 * Split a line holding several JSON objects ("{...}{...}" or "{...} {...}")
 * into one string per object. Text outside the objects is dropped; a cut-off
 * last object is kept so it is reported as invalid. A line without any
 * complete object is returned unchanged.
 */
export function splitObjects(line: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      if (depth > 0) inString = true;
    } else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}" && depth > 0) {
      depth--;
      if (depth === 0) objects.push(line.slice(start, i + 1));
    }
  }
  if (objects.length === 0) return [line];
  if (depth > 0) objects.push(line.slice(start));
  return objects;
}

/** Parse one line of model output, which may hold several JSON objects. */
export function parseLines(raw: string): ParsedLine[] {
  const line = raw.trim();
  if (!line) return [];
  return splitObjects(line)
    .map(parseLine)
    .filter((p): p is ParsedLine => p !== null);
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
