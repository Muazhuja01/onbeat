import { createObjectSplitter, parseObject, type ParsedLine } from "@/lib/suggest/protocol";
import type { ClaimVerdict } from "./claim-check";

type Queued = { stray: string } | { object: string };

function isWrapper(object: string): boolean {
  try {
    const json: unknown = JSON.parse(object);
    return typeof json === "object" && json !== null && "replies" in json;
  } catch {
    return false;
  }
}

/**
 * Passes model output through, one line per JSON object, and drops reply objects the
 * claim check calls invented. Stray text and invalid objects pass through unchanged so
 * the client still sees junk and can retry. Replies are checked one at a time, in order.
 *
 * A single reply object is yielded as the model wrote it. A {"replies": [...]} wrapper
 * is re-emitted as one line per kept entry, so a dropped reply cannot come back through
 * the wrapper. Invalid entries in a wrapper pass through once per wrapper. If nothing in
 * the wrapper is usable, the wrapper is yielded as it came.
 */
export async function* filterReplies(deltas: AsyncIterable<string>, check: (reply: string) => Promise<ClaimVerdict>): AsyncGenerator<string, void, undefined> {
  const pending: Queued[] = [];
  const splitter = createObjectSplitter(
    (object) => pending.push({ object }),
    (stray) => pending.push({ stray }),
  );
  const invented = async (entry: ParsedLine) => entry.kind === "reply" && (await check(entry.text)) === "invented";

  async function* drain() {
    while (pending.length) {
      const item = pending.shift()!;
      if ("stray" in item) {
        yield `${item.stray}\n`;
        continue;
      }
      const object = item.object.trim();
      const entries = parseObject(object);
      if (!isWrapper(object)) {
        if (!(await invented(entries[0]))) yield `${object}\n`;
        continue;
      }
      if (entries.every((e) => e.kind === "invalid")) {
        yield `${object}\n`;
        continue;
      }
      let invalidSent = false;
      for (const entry of entries) {
        if (entry.kind === "reply") {
          if (await invented(entry)) continue;
          yield `${JSON.stringify({ reply: entry.text, notes: entry.noteIds })}\n`;
        } else if (entry.kind === "reactions") {
          yield `${JSON.stringify({ reactions: entry.ids })}\n`;
        } else if (!invalidSent) {
          invalidSent = true;
          // Never re-emit an object: the client would parse it again and could accept it unchecked.
          yield `${entry.raw.startsWith("{") ? "invalid" : entry.raw}\n`;
        }
      }
    }
  }

  for await (const d of deltas) {
    splitter.push(d);
    yield* drain();
  }
  splitter.flush();
  yield* drain();
}
