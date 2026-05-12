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
  // All assertions use toMatchObject so the parser is free to attach
  // provenance (range) without breaking shape-based tests.

  it("reads primitives", () => {
    expect(parse("true")).toMatchObject({ kind: "bool", value: true });
    expect(parse("false")).toMatchObject({ kind: "bool", value: false });
    expect(parse("null")).toMatchObject({ kind: "null" });
    expect(parse("42")).toMatchObject({ kind: "int", value: 42 });
    expect(parse("3.14")).toMatchObject({ kind: "real", value: 3.14 });
    expect(parse("/Foo")).toMatchObject({ kind: "name", value: "Foo" });
  });

  it("attaches byte range to parsed values", () => {
    const v = parse("   42") as { kind: "int"; value: number; range?: { start: number; end: number } };
    expect(v.range).toBeDefined();
    expect(v.range!.start).toBe(3);
    expect(v.range!.end).toBe(5);
  });

  it("array and dict ranges span from open to close marker", () => {
    const arr = parse("[1 2 3]") as { kind: "array"; range?: { start: number; end: number } };
    expect(arr.range).toEqual({ start: 0, end: 7 });

    const dict = parse("<< /A 1 >>") as { kind: "dict"; range?: { start: number; end: number } };
    expect(dict.range).toEqual({ start: 0, end: 10 });
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
    expect(parse("12 0 R")).toMatchObject({ kind: "ref", target: "obj:12:0" });
  });

  it("does not consume two trailing integers as a reference", () => {
    const reader = new ByteReader(toBytes("12 0"));
    const tokens = new TokenStream(new Lexer(reader));
    const parser = new ValueParser(tokens);
    expect(parser.parseValue()).toMatchObject({ kind: "int", value: 12 });
    expect(parser.parseValue()).toMatchObject({ kind: "int", value: 0 });
  });

  it("content mode does NOT collapse `12 0 R` into a reference", () => {
    const reader = new ByteReader(toBytes("12 0 R"));
    const tokens = new TokenStream(new Lexer(reader));
    const parser = new ValueParser(tokens, { mode: "content" });
    expect(parser.parseValue()).toMatchObject({ kind: "int", value: 12 });
    expect(parser.parseValue()).toMatchObject({ kind: "int", value: 0 });
  });

  it("parses arrays and dicts recursively", () => {
    const v = parse("<< /Length 100 /Filter /FlateDecode /IDs [1 2 3] >>");
    expect(v.kind).toBe("dict");
    if (v.kind !== "dict") throw new Error();
    expect(v.entries.Length).toMatchObject({ kind: "int", value: 100 });
    expect(v.entries.Filter).toMatchObject({ kind: "name", value: "FlateDecode" });
    const ids = v.entries.IDs;
    expect(ids).toMatchObject({ kind: "array" });
    if (ids?.kind !== "array") throw new Error();
    expect(ids.items).toHaveLength(3);
    expect(ids.items[0]).toMatchObject({ kind: "int", value: 1 });
  });

  it("throws ParseError on unterminated dictionaries", () => {
    expect(() => parse("<< /Foo 1")).toThrow(/Unterminated dictionary/);
  });
});
