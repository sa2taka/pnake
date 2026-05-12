import { describe, expect, it } from "vitest";
import { buildManifest } from "../../../src/worker/pdf/structure/manifest";
import { toBytes } from "../../../src/worker/pdf/io/byte-reader";

function buildInheritingPagesPdf(): Uint8Array {
  // Root Pages defines MediaBox + Rotate + Resources; the inner Pages and Page leave
  // those out so inheritance has to fill them in.
  const header = "%PDF-1.7\n";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Count 2 /Kids [3 0 R] /MediaBox [0 0 595 842] /Rotate 90 /Resources << /ProcSet [/PDF] >> >>\nendobj\n",
    "3 0 obj\n<< /Type /Pages /Count 2 /Kids [4 0 R 5 0 R] /Parent 2 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Page /Parent 3 0 R >>\nendobj\n",
    "5 0 obj\n<< /Type /Page /Parent 3 0 R /Rotate 0 /MediaBox [0 0 612 792] >>\nendobj\n",
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
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets.map((o) => `${pad(o)} 00000 n \n`).join("") +
    "trailer\n<< /Size 6 /Root 1 0 R >>\n";
  const tail = `startxref\n${xrefOffset}\n%%EOF\n`;
  return toBytes(header + objects.join("") + xref + tail);
}

describe("Pages tree with attribute inheritance", () => {
  it("propagates MediaBox and Rotate from the root Pages", async () => {
    const analysis = await buildManifest(buildInheritingPagesPdf());
    expect(analysis.pages).toHaveLength(2);
    const [first, second] = analysis.pages;
    // Page 4 inherits MediaBox [0 0 595 842] and Rotate 90 from the root.
    expect(first?.boxes.mediaBox).toEqual({ x: 0, y: 0, w: 595, h: 842 });
    expect(first?.rotation).toBe(90);
    // Page 5 overrides locally.
    expect(second?.boxes.mediaBox).toEqual({ x: 0, y: 0, w: 612, h: 792 });
    expect(second?.rotation).toBe(0);
  });

  it("inherits a direct-dict /Resources through resourceDict", async () => {
    // The root Pages declares /Resources as an inline dict. Both leaf pages
    // omit /Resources, so the inline dict must propagate via resourceDict
    // (resourceRef stays undefined because the ancestor used a direct dict).
    const analysis = await buildManifest(buildInheritingPagesPdf());
    expect(analysis.pages.every((p) => p.resourceRef === undefined)).toBe(true);
    expect(analysis.pages.every((p) => p.resourceDict !== undefined)).toBe(true);
    // The inherited dict carries the /ProcSet declared on the ancestor.
    const dict = analysis.pages[0]!.resourceDict!;
    expect(dict.ProcSet).toMatchObject({ kind: "array" });
  });
});
