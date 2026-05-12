import { describe, expect, it } from "vitest";
import { buildManifest } from "../../../src/worker/pdf/structure/manifest";
import { toBytes } from "../../../src/worker/pdf/io/byte-reader";

/**
 * Construct a tiny classic-xref PDF: 1 catalog, 1 pages root, 1 page.
 */
function buildClassicPdf(): Uint8Array {
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
  return toBytes(header + objects.join("") + xref + tail);
}

describe("buildManifest (classic xref)", () => {
  it("returns a full PdfAnalysis for a minimal valid PDF", async () => {
    const bytes = buildClassicPdf();
    const analysis = await buildManifest(bytes);

    expect(analysis.fileInfo.pdfVersion).toBe("1.7");
    expect(analysis.fileInfo.byteSize).toBe(bytes.length);
    expect(analysis.fileInfo.encrypted).toBe(false);
    expect(analysis.fileInfo.incrementalUpdates).toBe(0);
    expect(analysis.fileStructure.bodies.length).toBe(1);
    expect(Object.keys(analysis.objectsIndex)).toEqual(
      expect.arrayContaining(["obj:1:0", "obj:2:0", "obj:3:0"]),
    );
    expect(analysis.documentTree?.catalogRef).toBe("obj:1:0");
    expect(analysis.documentTree?.pagesRootRef).toBe("obj:2:0");
    expect(analysis.pages.length).toBe(1);
    const page = analysis.pages[0]!;
    expect(page.pageNumber).toBe(1);
    expect(page.objectRef).toBe("obj:3:0");
    expect(page.boxes.mediaBox).toEqual({ x: 0, y: 0, w: 612, h: 792 });
  });

  it("captures EOF markers", async () => {
    const analysis = await buildManifest(buildClassicPdf());
    expect(analysis.fileStructure.eofMarkers.length).toBeGreaterThan(0);
  });

  it("classifies catalog/pages/page object types", async () => {
    const analysis = await buildManifest(buildClassicPdf());
    expect(analysis.objectsIndex["obj:1:0"]!.type).toBe("catalog");
    expect(analysis.objectsIndex["obj:2:0"]!.type).toBe("pages");
    expect(analysis.objectsIndex["obj:3:0"]!.type).toBe("page");
  });

  it("returns warnings on a truncated input", async () => {
    const truncated = buildClassicPdf().subarray(0, 50);
    await expect(buildManifest(truncated)).rejects.toThrow(/startxref/);
  });
});
