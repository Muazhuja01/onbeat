// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { ClaimVerdict } from "./claim-check";
import { filterReplies } from "./claim-filter";

async function* chunks(...xs: string[]) {
  for (const x of xs) yield x;
}
const collect = async (it: AsyncIterable<string>) => {
  const out: string[] = [];
  for await (const x of it) out.push(x);
  return out;
};

describe("filterReplies", () => {
  it("drops replies the check calls invented and keeps the rest in order", async () => {
    const check = vi.fn(async (reply: string): Promise<ClaimVerdict> => (reply.includes("park") ? "invented" : "ok"));
    const out = await collect(
      filterReplies(chunks('{"reply": "Yes.", "notes": []}\n{"reply": "I went to the ', 'park.", "notes": []}\n{"reactions": ["yes"]}'), check),
    );
    expect(out).toEqual(['{"reply": "Yes.", "notes": []}\n', '{"reactions": ["yes"]}\n']);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("keeps a reply when the check can't tell", async () => {
    const out = await collect(filterReplies(chunks('{"reply": "Maybe.", "notes": []}'), async () => "unknown"));
    expect(out).toEqual(['{"reply": "Maybe.", "notes": []}\n']);
  });

  it("passes invalid objects and stray text through, so the client can still retry junk", async () => {
    const out = await collect(filterReplies(chunks('I cannot help with that.\n{"other": 1}'), async () => "ok"));
    expect(out).toEqual(["I cannot help with that.\n", '{"other": 1}\n']);
  });

  it("splits a replies wrapper into one line per kept reply and drops the invented one", async () => {
    const check = vi.fn(async (reply: string): Promise<ClaimVerdict> => (reply.includes("park") ? "invented" : "ok"));
    const wrapper = '{"replies": [{"reply": "Yes.", "notes": ["n1"]}, "I went to the park.", {"reply": "No, thanks."}], "reactions": ["yes"]}';
    const out = await collect(filterReplies(chunks(wrapper), check));
    expect(out).toEqual(['{"reply":"Yes.","notes":["n1"]}\n', '{"reply":"No, thanks.","notes":[]}\n', '{"reactions":["yes"]}\n']);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("passes invalid wrapper entries through once per wrapper", async () => {
    const out = await collect(filterReplies(chunks('{"replies": ["Yes.", 1, 2]}'), async () => "ok"));
    expect(out).toEqual(['{"reply":"Yes.","notes":[]}\n', "1\n"]);
  });

  it("yields a wrapper with nothing usable as it came", async () => {
    const out = await collect(filterReplies(chunks('{"replies": []}'), async () => "ok"));
    expect(out).toEqual(['{"replies": []}\n']);
  });

  it("never lets an invalid wrapper entry come back as a reply or reactions line", async () => {
    const source = chunks(
      '{"replies": ["Yes.", {"replies": ["Sneaky."]}, {"reactions": ["yes"]}, {"reply": "  "}]}',
      '{"replies": [{"replies": ["Alone."]}]}',
    );
    const out = await collect(filterReplies(source, async () => "ok"));
    expect(out).toEqual(['{"reply":"Yes.","notes":[]}\n', "invalid\n", '{"replies": [{"replies": ["Alone."]}]}\n']);
    expect(out.join("").includes("Sneaky")).toBe(false);
    expect(out.join("").includes('"reactions"')).toBe(false);
  });

  it("does not let array items in a wrapper leak reply or reactions objects", async () => {
    const source = chunks('{"replies": ["Yes.", [{"reply": "Sneaky."}], [{"reactions": ["yes"]}]]}');
    const out = await collect(filterReplies(source, async () => "ok"));
    expect(out).toEqual(['{"reply":"Yes.","notes":[]}\n', "invalid\n"]);
  });

  it("stops reading the source when the consumer returns early", async () => {
    let closed = false;
    async function* source() {
      try {
        yield '{"reply": "One.", "notes": []}\n';
        yield '{"reply": "Two.", "notes": []}\n';
      } finally {
        closed = true;
      }
    }
    const it = filterReplies(source(), async () => "ok");
    await it.next();
    await it.return(undefined);
    expect(closed).toBe(true);
  });
});
