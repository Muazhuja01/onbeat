/** Yields the payload of each `data:` line of an OpenAI-style event stream. */
export async function* readSSEData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i).replace(/\r$/, "");
        buffer = buffer.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        if (data) yield data;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function contentDelta(data: string): string {
  try {
    const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
    return json.choices?.[0]?.delta?.content ?? "";
  } catch {
    return "";
  }
}
