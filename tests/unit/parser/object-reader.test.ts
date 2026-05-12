import { describe, expect, it } from "vitest";
import { ByteReader, toBytes } from "../../../src/worker/pdf/io/byte-reader";
import { IndirectObjectReader } from "../../../src/worker/pdf/parse/object-reader";

function makeReader(input: string): ByteReader {
  return new ByteReader(toBytes(input));
}

describe("IndirectObjectReader", () => {
  it("reads a simple non-stream object", () => {
    const src = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
    const r = new IndirectObjectReader(makeReader(src));
    const obj = r.readAt(0);
    expect(obj.id).toBe("obj:1:0");
    expect(obj.value.kind).toBe("dict");
    if (obj.value.kind !== "dict") throw new Error();
    expect(obj.value.entries.Pages).toEqual({ kind: "ref", target: "obj:2:0" });
    expect(obj.streamRange).toBeUndefined();
    expect(obj.range.start).toBe(0);
  });

  it("reads a stream object with a literal /Length", () => {
    const data = "abcdef"; // 6 bytes
    const src = `7 0 obj\n<< /Length ${data.length} >>\nstream\n${data}\nendstream\nendobj\n`;
    const bytes = toBytes(src);
    const r = new IndirectObjectReader(new ByteReader(bytes));
    const obj = r.readAt(0);
    expect(obj.value.kind).toBe("stream");
    expect(obj.streamRange).toBeDefined();
    if (!obj.streamRange) throw new Error();
    const stream = bytes.subarray(obj.streamRange.start, obj.streamRange.end);
    expect(Array.from(stream)).toEqual(Array.from(toBytes(data)));
  });

  it("falls back to scanning for endstream when /Length is missing", () => {
    const data = "XYZ";
    const src = `9 0 obj\n<< /Subtype /Image >>\nstream\n${data}\nendstream\nendobj\n`;
    const bytes = toBytes(src);
    const r = new IndirectObjectReader(new ByteReader(bytes));
    const obj = r.readAt(0);
    expect(obj.streamRange).toBeDefined();
    if (!obj.streamRange) throw new Error();
    const stream = bytes.subarray(obj.streamRange.start, obj.streamRange.end);
    expect(Array.from(stream)).toEqual(Array.from(toBytes(data)));
  });

  it("peekHeader returns just the object identifier metadata", () => {
    const src = "12 5 obj\n<< >>\nendobj\n";
    const r = new IndirectObjectReader(makeReader(src));
    expect(r.peekHeader(0)).toMatchObject({ number: 12, generation: 5 });
  });

  it("returns null from peekHeader when the offset is not an object", () => {
    const r = new IndirectObjectReader(makeReader("not an object"));
    expect(r.peekHeader(0)).toBeNull();
  });
});
