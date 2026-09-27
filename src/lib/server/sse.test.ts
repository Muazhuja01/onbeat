// @vitest-environment node
import { describe, expect, it } from "vitest";
import { contentDelta, readSSEData } from "./sse";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

describe("readSSEData", () => {
  it("yields data payloads across chunk boundaries and stops at DONE", async () => {
    const out: string[] = [];
    for await (const d of readSSEData(streamOf(["data: {\"a\":1}\n\nda", "ta: {\"b\":2}\r\n\n: comment\ndata: [DONE]\n\ndata: late\n\n"]))) out.push(d);
    expect(out).toEqual(['{"a":1}', '{"b":2}']);
  });
});

describe("contentDelta", () => {
  it("extracts delta content and ignores reasoning or junk", () => {
    expect(contentDelta('{"choices":[{"delta":{"content":"Hi"}}]}')).toBe("Hi");
    expect(contentDelta('{"choices":[{"delta":{"reasoning":"hmm"}}]}')).toBe("");
    expect(contentDelta("not json")).toBe("");
  });
});
