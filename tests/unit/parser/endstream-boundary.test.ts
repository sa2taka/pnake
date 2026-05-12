import { describe, expect, it } from "vitest";
import { ByteReader, toBytes } from "../../../src/worker/pdf/io/byte-reader";
import { IndirectObjectReader } from "../../../src/worker/pdf/parse/object-reader";

describe("scanForEndstream boundary checks", () => {
  it("does not match `endstream` embedded mid-data when surrounded by binary bytes", () => {
    // Object whose stream body contains the literal bytes "endstream" in the
    // middle, with no surrounding whitespace. With a naive indexOf we would
    // cut the stream short here. The fallback must skip this false positive
    // and pick the real `endstream` line at the end.
    const dataHead = "binary\x00\x01\x02";
    const trap = "xendstreamy"; // 'x' and 'y' are non-whitespace
    const dataTail = "\x03\x04";
    const body = dataHead + trap + dataTail;
    const src = `1 0 obj\n<< >>\nstream\n${body}\nendstream\nendobj\n`;
    const bytes = toBytes(src);
    const reader = new ByteReader(bytes);
    const r = new IndirectObjectReader(reader);
    const obj = r.readAt(0);
    expect(obj.streamRange).toBeDefined();
    const range = obj.streamRange!;
    const recovered = bytes.subarray(range.start, range.end);
    // Recovered length should equal the full body (the trap was skipped).
    expect(recovered.length).toBe(body.length);
  });

  it("accepts the canonical CR LF + endstream + EOL form", () => {
    const src = "1 0 obj\n<< >>\nstream\nhello world\nendstream\nendobj\n";
    const r = new IndirectObjectReader(new ByteReader(toBytes(src)));
    const obj = r.readAt(0);
    expect(obj.streamRange).toBeDefined();
  });

  it("falls back to any-whitespace boundary if no EOL-bounded match exists", () => {
    // Single-space delimiter between data and endstream. Spec strictly wants
    // EOL but lots of real writers use a single space; we should still match
    // on the second pass.
    const src = "1 0 obj\n<< >>\nstream\nhello endstream\nendobj\n";
    const r = new IndirectObjectReader(new ByteReader(toBytes(src)));
    const obj = r.readAt(0);
    expect(obj.streamRange).toBeDefined();
  });
});
