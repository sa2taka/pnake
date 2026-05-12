import { describe, expect, it } from "vitest";
import { InProcessParserService } from "../../../src/ui/services/parser-service";
import { toBytes } from "../../../src/worker/pdf/io/byte-reader";

function tinyPdf(): ArrayBuffer {
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
    "xref\n0 4\n0000000000 65535 f \n" +
    offsets.map((o) => `${pad(o)} 00000 n \n`).join("") +
    "trailer\n<< /Size 4 /Root 1 0 R >>\n";
  const tail = `startxref\n${xrefOffset}\n%%EOF\n`;
  return toBytes(header + objects.join("") + xref + tail).slice().buffer;
}

describe("ParserService CallOptions", () => {
  it("InProcess load() rejects with AbortError when the signal is pre-aborted", async () => {
    const parser = new InProcessParserService();
    const ac = new AbortController();
    ac.abort();
    await expect(
      parser.load(tinyPdf(), "tiny.pdf", { signal: ac.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("InProcess getObjectDetail() rejects on aborted signal without running", async () => {
    const parser = new InProcessParserService();
    await parser.load(tinyPdf());
    const ac = new AbortController();
    ac.abort();
    await expect(
      parser.getObjectDetail("obj:1:0", { signal: ac.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("InProcess accepts an empty options bag (no signal)", async () => {
    const parser = new InProcessParserService();
    const { analysis } = await parser.load(tinyPdf(), "tiny.pdf", {});
    expect(analysis.pages).toHaveLength(1);
  });
});
