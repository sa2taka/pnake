import { describe, expect, it } from "vitest";
import {
  ByteReader,
  asciiString,
  isDelimiter,
  isWhitespace,
  toBytes,
} from "../../../src/worker/pdf/io/byte-reader";

describe("ByteReader", () => {
  it("tracks position across reads", () => {
    const r = new ByteReader(toBytes("ABCD"));
    expect(r.pos).toBe(0);
    expect(r.read()).toBe(0x41);
    expect(r.read()).toBe(0x42);
    expect(r.pos).toBe(2);
  });

  it("returns -1 at EOF without advancing past it", () => {
    const r = new ByteReader(toBytes("X"));
    expect(r.read()).toBe(0x58);
    expect(r.eof).toBe(true);
    expect(r.read()).toBe(-1);
    expect(r.pos).toBe(1);
  });

  it("peeks without advancing", () => {
    const r = new ByteReader(toBytes("abc"));
    expect(r.peek()).toBe(0x61);
    expect(r.peek(2)).toBe(0x63);
    expect(r.peek(99)).toBeUndefined();
    expect(r.pos).toBe(0);
  });

  it("consumes bytes returning a subview", () => {
    const r = new ByteReader(toBytes("hello world"));
    const head = r.consume(5);
    expect(asciiString(head)).toBe("hello");
    expect(r.pos).toBe(5);
    expect(() => r.consume(99)).toThrow(/past end/);
  });

  it("skipWhile advances while predicate holds", () => {
    const r = new ByteReader(toBytes("   xyz"));
    expect(r.skipWhile(isWhitespace)).toBe(3);
    expect(r.pos).toBe(3);
  });

  it("consumeIf advances only on match", () => {
    const r = new ByteReader(toBytes("%PDF-1.7"));
    expect(r.consumeIf("FOO")).toBe(false);
    expect(r.pos).toBe(0);
    expect(r.consumeIf("%PDF-")).toBe(true);
    expect(r.pos).toBe(5);
  });

  it("indexOf and lastIndexOf locate sequences", () => {
    const r = new ByteReader(toBytes("aXXbXXcXX"));
    expect(r.indexOf("XX")).toBe(1);
    expect(r.indexOf("XX", 3)).toBe(4);
    expect(r.lastIndexOf("XX")).toBe(7);
    expect(r.indexOf("notfound")).toBe(-1);
  });

  it("classifies whitespace and delimiters per PDF spec", () => {
    expect(isWhitespace(0x20)).toBe(true);
    expect(isWhitespace(0x00)).toBe(true);
    expect(isWhitespace(0x41)).toBe(false);
    expect(isDelimiter(0x28)).toBe(true);
    expect(isDelimiter(0x2f)).toBe(true);
    expect(isDelimiter(0x41)).toBe(false);
  });

  it("rejects negative or out-of-range seeks", () => {
    const r = new ByteReader(toBytes("xy"));
    expect(() => r.seek(-1)).toThrow(/out of bounds/);
    expect(() => r.seek(99)).toThrow(/out of bounds/);
  });
});
