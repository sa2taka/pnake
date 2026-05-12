import { describe, expect, it } from "vitest";
import { ByteReader, toBytes } from "../../../src/worker/pdf/io/byte-reader";
import { parseXrefStream } from "../../../src/worker/pdf/structure/xref-stream";

async function deflate(input: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(input);
      controller.close();
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const encoded = source.pipeThrough(new CompressionStream("deflate") as any);
  const buf = await new Response(encoded).arrayBuffer();
  return new Uint8Array(buf);
}

function concat(parts: (Uint8Array | string)[]): Uint8Array {
  const buffers = parts.map((p) => (typeof p === "string" ? toBytes(p) : p));
  const total = buffers.reduce((acc, b) => acc + b.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const b of buffers) {
    out.set(b, pos);
    pos += b.length;
  }
  return out;
}

describe("parseXrefStream", () => {
  it("decodes a basic /Type /XRef stream with W=[1,3,1]", async () => {
    // Build 3 entries: free 0, in-use at 17 / gen 0, compressed in 99 idx 1.
    const entryBytes = new Uint8Array([
      0, 0x00, 0x00, 0x00, 0xff, // type 0, field2 = 0, field3 = 255 (gen)
      1, 0x00, 0x00, 0x11, 0x00, // type 1, offset 17, gen 0
      2, 0x00, 0x00, 0x63, 0x01, // type 2, parent obj 99, idx 1
    ]);
    const compressed = await deflate(entryBytes);
    const lenStr = String(compressed.length);

    const objHeader =
      `7 0 obj\n<< /Type /XRef /Size 3 /W [1 3 1] /Filter /FlateDecode /Length ${lenStr} >>\nstream\n`;
    const objTrailer = "\nendstream\nendobj\n";
    const pdfBytes = concat([objHeader, compressed, objTrailer]);

    const reader = new ByteReader(pdfBytes);
    const { xref, trailer, warnings } = await parseXrefStream(reader, 0);
    expect(warnings).toEqual([]);
    expect(xref.kind).toBe("stream");
    expect(xref.entries.length).toBe(3);
    expect(xref.entries[0]).toMatchObject({ objectNumber: 0, type: "f" });
    expect(xref.entries[1]).toMatchObject({ objectNumber: 1, type: "n", offset: 17 });
    expect(xref.entries[2]).toMatchObject({
      objectNumber: 2,
      type: "compressed",
      compressedIn: "obj:99:0",
      indexInStream: 1,
    });
    expect(trailer.dict.Size).toMatchObject({ kind: "int", value: 3 });
  });

  it("honors /Index for sparse object ranges", async () => {
    const entryBytes = new Uint8Array([
      1, 0x00, 0x00, 0x0a, 0x00, // type 1, offset 10, gen 0
      1, 0x00, 0x00, 0x14, 0x00, // type 1, offset 20, gen 0
    ]);
    const compressed = await deflate(entryBytes);
    const header = `1 0 obj\n<< /Type /XRef /Size 10 /Index [3 2] /W [1 3 1] /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`;
    const pdfBytes = concat([header, compressed, "\nendstream\nendobj\n"]);

    const reader = new ByteReader(pdfBytes);
    const { xref } = await parseXrefStream(reader, 0);
    expect(xref.entries.map((e) => e.objectNumber)).toEqual([3, 4]);
  });
});
