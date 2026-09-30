// @vitest-environment node
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { documentKind, extractDocumentText } from "./document-text";

async function docx(text: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

/** A one-page PDF with correct byte offsets. */
function pdf(text: string): Uint8Array {
  const content = `BT /F1 18 Tf 20 60 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

describe("extractDocumentText", () => {
  it("knows the supported types by extension", () => {
    expect(documentKind("me.TXT")).toBe("text");
    expect(documentKind("me.md")).toBe("text");
    expect(documentKind("me.docx")).toBe("docx");
    expect(documentKind("me.pdf")).toBe("pdf");
    expect(documentKind("me.doc")).toBeNull();
    expect(documentKind("pdf")).toBeNull();
  });

  it("reads plain text, Word and PDF", async () => {
    expect(await extractDocumentText("a.txt", new TextEncoder().encode("I'm Maya.\r\n\r\n\r\n\r\nHi \r\n"))).toBe("I'm Maya.\n\nHi");
    expect(await extractDocumentText("a.docx", await docx("Sam is my barista."))).toBe("Sam is my barista.");
    expect(await extractDocumentText("a.pdf", pdf("I have physio on Tuesdays."))).toContain("I have physio on Tuesdays.");
  });

  it("refuses other types", async () => {
    await expect(extractDocumentText("a.exe", new Uint8Array())).rejects.toThrow("unsupported");
  });
});
