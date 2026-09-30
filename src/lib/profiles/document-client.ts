import type { DraftNote } from "./notes";

export const DOCUMENT_ACCEPT = ".txt,.md,.docx,.pdf";
const MAX_BYTES = 4 * 1024 * 1024;

export type DocumentResult = { ok: true; notes: DraftNote[]; truncated: boolean } | { ok: false; message: string };

const MESSAGES: Record<string, string> = {
  too_large: "That file is over 4 MB. Try a shorter document.",
  unsupported: "OnBeat can read text (.txt, .md), Word (.docx) and PDF files.",
  no_text: "OnBeat couldn't find any text in that file. If it's a scan or a photo, type the notes yourself instead.",
  rate_limited: "Too many documents at once. Wait a minute and try again.",
  unavailable: "The AI service is busy. Please try again in a minute. You can still type notes yourself.",
};

/** Sends a document to /api/notes-from-document and turns every failure into a sentence the user can act on. */
export async function notesFromDocument(file: File, fetchImpl: typeof fetch = fetch): Promise<DocumentResult> {
  if (!/\.(txt|md|docx|pdf)$/i.test(file.name)) return { ok: false, message: MESSAGES.unsupported };
  if (file.size > MAX_BYTES) return { ok: false, message: MESSAGES.too_large };
  const form = new FormData();
  form.append("file", file);
  let res: Response;
  try {
    res = await fetchImpl("/api/notes-from-document", { method: "POST", body: form });
  } catch {
    return { ok: false, message: "OnBeat couldn't reach the AI service. Check your connection and try again." };
  }
  const body = (await res.json().catch(() => ({}))) as { notes?: DraftNote[]; truncated?: boolean; error?: string };
  if (!res.ok || !Array.isArray(body.notes)) return { ok: false, message: MESSAGES[body.error ?? ""] ?? MESSAGES.unavailable };
  if (body.notes.length === 0) return { ok: false, message: "No notes came out of that document. You can type notes yourself instead." };
  return { ok: true, notes: body.notes, truncated: !!body.truncated };
}
