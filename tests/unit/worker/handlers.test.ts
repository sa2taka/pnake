import { describe, expect, it } from "vitest";
import { ParserState } from "../../../src/worker/handlers";
import { toBytes } from "../../../src/worker/pdf/io/byte-reader";

function buildClassicPdf(): ArrayBuffer {
  const header = "%PDF-1.7\n";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
  ];
  let cursor = header.length;
  const offsets = objects.map((o) => {
    const off = cursor;
    cursor += o.length;
    return off;
  });
  const xrefOffset = cursor;
  const pad = (n: number) => n.toString().padStart(10, "0");
  const xref =
    "xref\n0 4\n" +
    "0000000000 65535 f \n" +
    `${pad(offsets[0]!)} 00000 n \n` +
    `${pad(offsets[1]!)} 00000 n \n` +
    `${pad(offsets[2]!)} 00000 n \n` +
    "trailer\n<< /Size 4 /Root 1 0 R >>\n";
  const tail = `startxref\n${xrefOffset}\n%%EOF\n`;
  const bytes = toBytes(header + objects.join("") + xref + tail);
  // Return a fresh ArrayBuffer matching exactly the bytes' contents.
  return bytes.slice().buffer;
}

describe("ParserState", () => {
  it("loads a PDF and returns the manifest", async () => {
    const state = new ParserState();
    const { analysis } = await state.load(buildClassicPdf());
    expect(analysis.fileInfo.pdfVersion).toBe("1.7");
    expect(analysis.pages).toHaveLength(1);
  });

  it("returns object detail with value and raw text", async () => {
    const state = new ParserState();
    await state.load(buildClassicPdf());
    const detail = state.getObjectDetail("obj:1:0");
    expect(detail.id).toBe("obj:1:0");
    expect(detail.type).toBe("catalog");
    expect(detail.value.kind).toBe("dict");
    expect(detail.rawText).toContain("Catalog");
    expect(detail.rawText).toContain("Pages 2 0 R");
  });

  it("rejects detail requests for unknown objects", async () => {
    const state = new ParserState();
    await state.load(buildClassicPdf());
    expect(() => state.getObjectDetail("obj:999:0")).toThrow(/not found/);
  });

  it("throws before a PDF is loaded", () => {
    const state = new ParserState();
    expect(() => state.getObjectDetail("obj:1:0")).toThrow(/No PDF loaded/);
  });
});
