export const DOCUMENT_MAX_BYTES = 4 * 1024 * 1024;
export const DOCUMENT_MAX_CHARS = 20_000;

export function documentKind(name: string): "text" | "docx" | "pdf" | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (ext === "txt" || ext === "md") return "text";
  if (ext === "docx") return "docx";
  if (ext === "pdf") return "pdf";
  return null;
}

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The plain text of an uploaded document. Throws for types OnBeat can't read. */
export async function extractDocumentText(name: string, bytes: Uint8Array): Promise<string> {
  switch (documentKind(name)) {
    case "text":
      return tidy(new TextDecoder("utf-8").decode(bytes));
    case "docx": {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return tidy(value);
    }
    case "pdf": {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const doc = await getDocumentProxy(bytes);
      const { text } = await extractText(doc, { mergePages: true });
      return tidy(text);
    }
    default:
      throw new Error("unsupported");
  }
}
