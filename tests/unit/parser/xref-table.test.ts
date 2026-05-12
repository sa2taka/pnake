import { describe, expect, it } from "vitest";
import { ByteReader, toBytes } from "../../../src/worker/pdf/io/byte-reader";
import {
  findEofMarkers,
  findStartxref,
  parseXrefAndTrailer,
} from "../../../src/worker/pdf/structure/xref-table";

/**
 * Hand-rolled minimal PDF body for testing.
 *
 *   - object 1, 2, 3
 *   - one xref subsection covering 0..3
 *   - trailer with /Size /Root
 */
function makeMinimalPdf(): string {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Count 0 /Kids [] >>\nendobj\n",
    "3 0 obj\n<< /Type /Info /Title (pnake test) >>\nendobj\n",
  ];
  // Compute byte offsets for each object.
  let cursor = "%PDF-1.7\n".length;
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(cursor);
    cursor += obj.length;
  }
  const xrefOffset = cursor;
  const pad = (n: number, w: number) => n.toString(10).padStart(w, "0");
  const xrefBody =
    "xref\n0 4\n" +
    "0000000000 65535 f \n" +
    `${pad(offsets[0]!, 10)} 00000 n \n` +
    `${pad(offsets[1]!, 10)} 00000 n \n` +
    `${pad(offsets[2]!, 10)} 00000 n \n` +
    "trailer\n<< /Size 4 /Root 1 0 R >>\n";
  const startxref = `startxref\n${xrefOffset}\n%%EOF\n`;
  return "%PDF-1.7\n" + objects.join("") + xrefBody + startxref;
}

describe("parseXrefAndTrailer (classic table)", () => {
  it("parses subsections, entries, and trailer dict", () => {
    const pdfText = makeMinimalPdf();
    const reader = new ByteReader(toBytes(pdfText));
    const xrefOffset = pdfText.indexOf("xref\n");
    expect(xrefOffset).toBeGreaterThan(0);

    const { xref, trailer, warnings } = parseXrefAndTrailer(reader, xrefOffset);
    expect(warnings).toEqual([]);
    expect(xref.kind).toBe("table");
    if (xref.kind !== "table") throw new Error();
    expect(xref.entries.length).toBe(4);
    expect(xref.entries[0]).toMatchObject({ objectNumber: 0, type: "f" });
    expect(xref.entries[1]).toMatchObject({ objectNumber: 1, type: "n" });
    expect(trailer.dict.Size).toEqual({ kind: "int", value: 4 });
    expect(trailer.dict.Root).toEqual({ kind: "ref", target: "obj:1:0" });
  });

  it("findStartxref locates the latest startxref offset", () => {
    const pdfText = makeMinimalPdf();
    const reader = new ByteReader(toBytes(pdfText));
    const expected = pdfText.indexOf("xref\n");
    expect(findStartxref(reader)).toBe(expected);
  });

  it("findEofMarkers finds every %%EOF in the file", () => {
    const reader = new ByteReader(toBytes("%PDF-1.7\nfoo\n%%EOF\nbar\n%%EOF\n"));
    const markers = findEofMarkers(reader);
    expect(markers).toHaveLength(2);
  });

  it("emits a warning instead of throwing on a malformed entry", () => {
    // 20-byte non-conforming entry: leading 10 chars are letters, not digits.
    const broken =
      "%PDF-1.7\nxref\n0 2\n" +
      "0000000000 65535 f \n" +
      "abcdefghij 65535 n \n" +
      "trailer\n<< /Size 2 >>\n";
    const reader = new ByteReader(toBytes(broken));
    const { warnings } = parseXrefAndTrailer(reader, broken.indexOf("xref\n"));
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]!.category).toBe("xref");
  });
});
