import { describe, expect, it } from "vitest";
import { ByteReader, toBytes } from "../../../src/worker/pdf/io/byte-reader";
import { IndirectObjectReader } from "../../../src/worker/pdf/parse/object-reader";
import { parseObjectStream } from "../../../src/worker/pdf/structure/object-stream";

async function deflate(input: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(input);
      c.close();
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const encoded = source.pipeThrough(new CompressionStream("deflate") as any);
  return new Uint8Array(await new Response(encoded).arrayBuffer());
}

function concat(parts: (Uint8Array | string)[]): Uint8Array {
  const buffers = parts.map((p) => (typeof p === "string" ? toBytes(p) : p));
  const total = buffers.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const b of buffers) {
    out.set(b, pos);
    pos += b.length;
  }
  return out;
}

describe("parseObjectStream", () => {
  it("recovers the bodies of compressed objects", async () => {
    // Two compressed objects: 5 = << /A 1 >>, 6 = (hi)
    // Header lists "5 0 6 14" then bodies "<< /A 1 >>" and "(hi)" at /First.
    const body = toBytes("<< /A 1 >>(hi)");
    const header = toBytes("5 0 6 11 "); // "5 0 6 11 " — note offset matches end of first body
    // Compute /First as the byte index where bodies start, i.e. header.length
    const first = header.length;
    const offsets = [0, "<< /A 1 >>".length];
    // Rewrite the header with the correct offset for the second body.
    const newHeader = toBytes(`5 ${offsets[0]} 6 ${offsets[1]} `);
    const streamPayload = concat([newHeader, body]);
    const compressed = await deflate(streamPayload);

    const objHeader =
      `9 0 obj\n<< /Type /ObjStm /N 2 /First ${newHeader.length} /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`;
    const pdfBytes = concat([objHeader, compressed, "\nendstream\nendobj\n"]);

    const reader = new ByteReader(pdfBytes);
    const objReader = new IndirectObjectReader(reader);
    const obj = objReader.readAt(0);
    const result = await parseObjectStream(reader, obj);
    expect(result.entries.length).toBe(2);
    const [first1, second] = result.entries;
    expect(first1?.id).toBe("obj:5:0");
    expect(first1?.value.kind).toBe("dict");
    expect(second?.id).toBe("obj:6:0");
    expect(second?.value.kind).toBe("string");
    void first;
  });
});
