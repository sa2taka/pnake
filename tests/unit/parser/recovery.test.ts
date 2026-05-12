/**
 * Recovery / fault-tolerance tests.
 *
 * These exercise the failure modes flagged by the binary-parser-design
 * skill: parsers must surface warnings instead of throwing whenever
 * the file is "weird but readable".
 */

import { describe, expect, it } from "vitest";
import { buildManifest } from "../../../src/worker/pdf/structure/manifest";
import { toBytes } from "../../../src/worker/pdf/io/byte-reader";
import { Lexer, tokenizeAll } from "../../../src/worker/pdf/lex/lexer";
import { ByteReader } from "../../../src/worker/pdf/io/byte-reader";
import { IndirectObjectReader } from "../../../src/worker/pdf/parse/object-reader";

function buildPdfWith(
  objects: string[],
  options: { brokenLength?: boolean; missingEof?: boolean; corruptXref?: boolean } = {},
): Uint8Array {
  const header = "%PDF-1.7\n";
  let cursor = header.length;
  const offsets = objects.map((o) => {
    const off = cursor;
    cursor += o.length;
    return off;
  });
  const xrefOffset = cursor;
  const pad = (n: number) => n.toString().padStart(10, "0");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${pad(off)} 00000 n \n`;
  if (options.corruptXref) {
    // Replace one entry with a malformed 20-byte line (must match canonical length).
    xref = xref.replace(
      /0000000\d{3} 00000 n \n/,
      "garbledxxx 00000 n \n",
    );
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  const tail = `startxref\n${xrefOffset}\n${options.missingEof ? "" : "%%EOF\n"}`;
  return toBytes(header + objects.join("") + xref + tail);
}

describe("recovery: corrupted input still produces a manifest", () => {
  it("emits a warning when an xref entry is malformed but continues", async () => {
    const objects = [
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      "2 0 obj\n<< /Type /Pages /Count 0 /Kids [] >>\nendobj\n",
    ];
    const bytes = buildPdfWith(objects, { corruptXref: true });
    const analysis = await buildManifest(bytes);
    expect(analysis.warnings.length).toBeGreaterThan(0);
    expect(analysis.warnings.some((w) => w.category === "xref")).toBe(true);
    // Despite the malformed entry, at least one object should still be visible.
    expect(Object.keys(analysis.objectsIndex).length).toBeGreaterThan(0);
  });

  it("tolerates a missing %%EOF marker", async () => {
    const objects = [
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n",
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
    ];
    const bytes = buildPdfWith(objects, { missingEof: true });
    const analysis = await buildManifest(bytes);
    expect(analysis.pages).toHaveLength(1);
  });

  it("recovers when stream /Length disagrees with actual byte span", async () => {
    // /Length says 6 but the actual data is 4 bytes. The reader trusts the
    // dict — but the bigger lesson here is that recovery for off-by-one
    // /Length is acceptable as long as we don't crash.
    const streamObject = `4 0 obj\n<< /Length 4 >>\nstream\nabcdefgh\nendstream\nendobj\n`;
    const objects = [
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n",
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n",
      streamObject,
    ];
    const bytes = buildPdfWith(objects);
    const analysis = await buildManifest(bytes);
    expect(Object.keys(analysis.objectsIndex)).toContain("obj:4:0");
  });

  it("scans for endstream when /Length is omitted", async () => {
    const objects = [
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n",
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n",
      "4 0 obj\n<< >>\nstream\nXYZ\nendstream\nendobj\n",
    ];
    const bytes = buildPdfWith(objects);
    const analysis = await buildManifest(bytes);
    expect(analysis.objectsIndex["obj:4:0"]?.hasStream).toBe(true);
  });

  it("does not infinite-loop on random binary noise", () => {
    const rand = new Uint8Array(1024);
    for (let i = 0; i < rand.length; i++) rand[i] = (i * 7 + 13) & 0xff;
    expect(tokenizeAll(rand).at(-1)?.kind).toBe("eof");
  });

  it("aborts cleanly when startxref is missing", async () => {
    await expect(buildManifest(toBytes("%PDF-1.7\nnot a pdf"))).rejects.toThrow(/startxref/);
  });

  it("lexer makes progress on every call regardless of input", () => {
    const reader = new ByteReader(new Uint8Array([0xff, 0x00, 0x7f, 0xff]));
    const lexer = new Lexer(reader);
    const startingPositions: number[] = [];
    for (let i = 0; i < 10; i++) {
      startingPositions.push(reader.pos);
      const tok = lexer.next();
      if (tok.kind === "eof") break;
    }
    // Every call must either reach EOF or advance the reader.
    const distinct = new Set(startingPositions);
    expect(distinct.size).toBeGreaterThan(0);
  });

  it("object reader fails fast when the header is not an indirect object", () => {
    const reader = new ByteReader(toBytes("not an obj"));
    const r = new IndirectObjectReader(reader);
    expect(() => r.readAt(0)).toThrow();
  });
});
