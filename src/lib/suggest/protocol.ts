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

const FENCE = /^`{3}[\w-]*$/;

/**
 * Reads model output as a stream of JSON objects, whatever the line breaks: models
 * sometimes pretty-print an object over several lines or wrap the output in a
 * markdown fence. Each top-level object is emitted as soon as its closing brace
 * arrives. Text between objects is reported line by line through onStray, except
 * blank lines and fences. flush() emits a cut-off last object, so it can be counted
 * as invalid.
 */
export function createObjectSplitter(onObject: (json: string) => void, onStray: (text: string) => void = () => {}) {
  let current = "";
  let stray = "";
  let depth = 0;
  let inString = false;
  let escaped = false;

  const endStray = () => {
    const t = stray.trim();
    stray = "";
    if (t && !FENCE.test(t)) onStray(t);
  };

  return {
    push(chunk: string) {
      for (const c of chunk) {
        if (depth === 0) {
          if (c === "{") {
            endStray();
            current = "{";
            depth = 1;
          } else if (c === "\n") {
            endStray();
          } else {
            stray += c;
          }
          continue;
        }
        current += c;
        if (inString) {
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === '"') inString = false;
        } else if (c === '"') {
          inString = true;
        } else if (c === "{") {
          depth++;
        } else if (c === "}") {
          depth--;
          if (depth === 0) {
            onObject(current);
            current = "";
          }
        }
      }
    },
    flush() {
      if (depth > 0 && current.trim()) onObject(current);
      endStray();
      current = "";
      depth = 0;
      inString = false;
      escaped = false;
    },
  };
}
