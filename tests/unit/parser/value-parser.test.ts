import { describe, expect, it } from "vitest";
import { asciiString, toBytes, ByteReader } from "../../../src/worker/pdf/io/byte-reader";
import { Lexer } from "../../../src/worker/pdf/lex/lexer";
import { TokenStream } from "../../../src/worker/pdf/lex/token-stream";
import { ValueParser } from "../../../src/worker/pdf/parse/value-parser";
import type { PdfValue } from "../../../src/shared/ir-types";

function parse(input: string): PdfValue {
  const reader = new ByteReader(toBytes(input));
  const lexer = new Lexer(reader);
  const tokens = new TokenStream(lexer);
  return new ValueParser(tokens).parseValue();
}

describe("ValueParser", () => {
  it("reads primitives", () => {
    expect(parse("true")).toEqual({ kind: "bool", value: true });
    expect(parse("false")).toEqual({ kind: "bool", value: false });
    expect(parse("null")).toEqual({ kind: "null" });
    expect(parse("42")).toEqual({ kind: "int", value: 42 });
    expect(parse("3.14")).toEqual({ kind: "real", value: 3.14 });
    expect(parse("/Foo")).toEqual({ kind: "name", value: "Foo" });
  });

  it("reads literal and hex strings", () => {
    const a = parse("(hi)") as { kind: "string"; raw: Uint8Array; hex?: boolean };
    expect(a.kind).toBe("string");
    expect(asciiString(a.raw)).toBe("hi");
    expect(a.hex).toBeUndefined();

    const b = parse("<48656C6C6F>") as { kind: "string"; raw: Uint8Array; hex?: boolean };
    expect(asciiString(b.raw)).toBe("Hello");
    expect(b.hex).toBe(true);
  });

  it("recognizes the N G R reference triple", () => {
    expect(parse("12 0 R")).toEqual({ kind: "ref", target: "obj:12:0" });
  });

  it("does not consume two trailing integers as a reference", () => {
    // "12 0" without R must remain two integers — first call returns 12.
    const reader = new ByteReader(toBytes("12 0"));
    const tokens = new TokenStream(new Lexer(reader));
    const parser = new ValueParser(tokens);
    expect(parser.parseValue()).toEqual({ kind: "int", value: 12 });
    expect(parser.parseValue()).toEqual({ kind: "int", value: 0 });
  });

  it("content mode does NOT collapse `12 0 R` into a reference", () => {
    // R is just an arbitrary keyword in content streams; refs are not legal.
    const reader = new ByteReader(toBytes("12 0 R"));
    const tokens = new TokenStream(new Lexer(reader));
    const parser = new ValueParser(tokens, { mode: "content" });
    expect(parser.parseValue()).toEqual({ kind: "int", value: 12 });
    expect(parser.parseValue()).toEqual({ kind: "int", value: 0 });
  });

  it("parses arrays and dicts recursively", () => {
    const v = parse("<< /Length 100 /Filter /FlateDecode /IDs [1 2 3] >>");
    expect(v.kind).toBe("dict");
    if (v.kind !== "dict") throw new Error();
    expect(v.entries.Length).toEqual({ kind: "int", value: 100 });
    expect(v.entries.Filter).toEqual({ kind: "name", value: "FlateDecode" });
    expect(v.entries.IDs).toEqual({
      kind: "array",
      items: [
        { kind: "int", value: 1 },
        { kind: "int", value: 2 },
        { kind: "int", value: 3 },
      ],
    });
  });

  it("throws ParseError on unterminated dictionaries", () => {
    expect(() => parse("<< /Foo 1")).toThrow(/Unterminated dictionary/);
  });
});
