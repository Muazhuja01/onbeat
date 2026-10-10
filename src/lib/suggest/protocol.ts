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

// Trimmed before the length check, so a reply of only spaces is invalid rather than a blank button.
const ReplyText = z.string().trim().min(1).max(200);
const ReplyLine = z.object({ reply: ReplyText, notes: z.array(z.string()).default([]) });
const ReactionsLine = z.object({ reactions: z.array(z.string()).max(4) });

export type ParsedLine =
  | { kind: "reply"; text: string; noteIds: string[] }
  | { kind: "reactions"; ids: string[] }
  | { kind: "invalid"; raw: string };

const WrapperItem = z.union([
  ReplyText.transform((text) => ({ text, notes: [] as string[] })),
  z.object({ reply: ReplyText, notes: z.array(z.string()).default([]) }).transform((o) => ({ text: o.reply, notes: o.notes })),
  z.object({ text: ReplyText, notes: z.array(z.string()).default([]) }).transform((o) => ({ text: o.text, notes: o.notes })),
]);
const RepliesWrapper = z.object({ replies: z.array(z.unknown()), reactions: z.array(z.string()).max(4).optional() });

/**
 * Parses one JSON object from the model. A reply line, a reactions line or junk gives one
 * entry. A {"replies": [...]} wrapper gives one entry per item, then a reactions entry if
 * the wrapper has one. A top-level notes array is ignored: it cannot be tied to a reply.
 */
export function parseObject(raw: string): ParsedLine[] {
  const line = raw.trim();
  if (!line) return [];
  if (!line.startsWith("{")) return [{ kind: "invalid", raw: line }];
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return [{ kind: "invalid", raw: line }];
  }
  const reply = ReplyLine.safeParse(json);
  if (reply.success) return [{ kind: "reply", text: reply.data.reply.trim(), noteIds: reply.data.notes }];
  const wrapper = RepliesWrapper.safeParse(json);
  if (wrapper.success) {
    const out: ParsedLine[] = wrapper.data.replies.map((item) => {
      const parsed = WrapperItem.safeParse(item);
      return parsed.success
        ? { kind: "reply" as const, text: parsed.data.text, noteIds: parsed.data.notes }
        : { kind: "invalid" as const, raw: JSON.stringify(item) };
    });
    if (wrapper.data.reactions) out.push({ kind: "reactions", ids: wrapper.data.reactions });
    // An empty wrapper is junk, so the client can retry, unless it still carries reactions.
    return out.length ? out : [{ kind: "invalid", raw: line }];
  }
  const reactions = ReactionsLine.safeParse(json);
  if (reactions.success) return [{ kind: "reactions", ids: reactions.data.reactions }];
  return [{ kind: "invalid", raw: line }];
}

export function parseLine(raw: string): ParsedLine | null {
  return parseObject(raw)[0] ?? null;
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
