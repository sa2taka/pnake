import { describe, expect, it } from "vitest";
import { buildManifest } from "../../../src/worker/pdf/structure/manifest";
import { toBytes } from "../../../src/worker/pdf/io/byte-reader";

function buildFormPdf(): Uint8Array {
  const header = "%PDF-1.7\n";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R /AcroForm 5 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
    // intentional gap so xref aligns with object numbers
    "4 0 obj\n<< /Type /Group >>\nendobj\n",
    "5 0 obj\n<< /Fields [6 0 R 7 0 R 8 0 R] >>\nendobj\n",
    "6 0 obj\n<< /T (full_name) /FT /Tx /V (John Doe) >>\nendobj\n",
    "7 0 obj\n<< /T (subscribe) /FT /Btn >>\nendobj\n",
    "8 0 obj\n<< /T (signature) /FT /Sig /V 9 0 R >>\nendobj\n",
    "9 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite >>\nendobj\n",
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
    "xref\n0 10\n0000000000 65535 f \n" +
    offsets.map((o) => `${pad(o)} 00000 n \n`).join("") +
    "trailer\n<< /Size 10 /Root 1 0 R >>\n";
  const tail = `startxref\n${xrefOffset}\n%%EOF\n`;
  return toBytes(header + objects.join("") + xref + tail);
}

describe("AcroForm enumeration", () => {
  it("collects form fields with type, value, and signed flag", async () => {
    const analysis = await buildManifest(buildFormPdf());
    expect(analysis.formFields.map((f) => f.fullName).sort()).toEqual([
      "full_name",
      "signature",
      "subscribe",
    ]);
    const tx = analysis.formFields.find((f) => f.fullName === "full_name");
    expect(tx?.fieldType).toBe("Tx");
    expect(tx?.value).toBe("John Doe");

    const sig = analysis.formFields.find((f) => f.fullName === "signature");
    expect(sig?.fieldType).toBe("Sig");
    expect(sig?.signed).toBe(true);

    expect(analysis.fileInfo.signatures).toBe(1);
    expect(analysis.fileInfo.formFields).toBe(3);
    expect(analysis.fileInfo.acroForm).toBe(true);
  });
});
