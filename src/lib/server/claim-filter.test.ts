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
});
