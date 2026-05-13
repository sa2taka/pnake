import { describe, expect, it } from "vitest";
import { ByteReader, asciiString, toBytes } from "../../../src/worker/pdf/io/byte-reader";
import { Lexer, tokenizeAll } from "../../../src/worker/pdf/lex/lexer";
import type { Token } from "../../../src/worker/pdf/lex/tokens";

function lex(input: string): Token[] {
  return tokenizeAll(toBytes(input));
}

function kindsOf(input: string): Token["kind"][] {
  return lex(input).map((t) => t.kind);
}

describe("Lexer — primitive tokens", () => {
  it("recognizes booleans and null", () => {
    expect(kindsOf("true false null")).toEqual(["true", "false", "null", "eof"]);
  });

  it("recognizes integers and reals with signs and leading dots", () => {
    const tokens = lex("123 -45 +0.0 .5 -.5");
    expect(tokens.map((t) => t.kind)).toEqual([
      "integer",
      "integer",
      "real",
      "real",
      "real",
      "eof",
    ]);
    expect((tokens[0] as { value: number }).value).toBe(123);
    expect((tokens[1] as { value: number }).value).toBe(-45);
    expect((tokens[2] as { value: number }).value).toBe(0);
    expect((tokens[3] as { value: number }).value).toBe(0.5);
    expect((tokens[4] as { value: number }).value).toBe(-0.5);
  });

  it("eats comments and continues", () => {
    expect(kindsOf("%PDF-1.7\n42")).toEqual(["integer", "eof"]);
  });

  it("emits dict and array markers", () => {
    expect(kindsOf("<< [ ] >>")).toEqual(["dictStart", "arrayStart", "arrayEnd", "dictEnd", "eof"]);
  });
});

describe("Lexer — names", () => {
  it("reads simple names", () => {
    const t = lex("/Foo")[0]!;
    expect(t.kind).toBe("name");
    expect((t as { value: string }).value).toBe("Foo");
  });

  it("decodes #XX escapes", () => {
    const t = lex("/A#20B")[0]!;
    expect((t as { value: string }).value).toBe("A B");
  });

  it("preserves the byte range of the original name", () => {
    const tokens = lex("    /Length");
    const name = tokens[0]!;
    expect(name.kind).toBe("name");
    expect(name.range).toEqual({ start: 4, end: 11 });
  });
});

describe("Lexer — strings", () => {
  it("reads literal strings with escapes", () => {
    const t = lex(`(Hello\\nWorld)`)[0]!;
    expect(t.kind).toBe("stringLiteral");
    expect(asciiString((t as { value: Uint8Array }).value)).toBe("Hello\nWorld");
  });

  it("handles balanced nested parens", () => {
    const t = lex(`(foo (bar) baz)`)[0]!;
    expect(asciiString((t as { value: Uint8Array }).value)).toBe("foo (bar) baz");
  });

  it("decodes octal escapes", () => {
    const t = lex(`(\\101)`)[0]!; // \101 = 'A'
    expect(asciiString((t as { value: Uint8Array }).value)).toBe("A");
  });

  it("normalizes CR / CRLF to LF inside literal strings", () => {
    const reader = new ByteReader(Uint8Array.from([40, 0x41, 0x0d, 0x0a, 0x42, 41]));
    const lexer = new Lexer(reader);
    const t = lexer.next();
    expect(t.kind).toBe("stringLiteral");
    expect((t as { value: Uint8Array }).value).toEqual(Uint8Array.from([0x41, 0x0a, 0x42]));
  });

  it("reads hex strings, padding odd nibble counts with 0", () => {
    const t = lex("<deadbe>")[0]!;
    expect(t.kind).toBe("stringHex");
    expect((t as { value: Uint8Array }).value).toEqual(Uint8Array.from([0xde, 0xad, 0xbe]));
    const t2 = lex("<dab>")[0]!;
    expect((t2 as { value: Uint8Array }).value).toEqual(Uint8Array.from([0xda, 0xb0]));
  });
});

describe("Lexer — keywords and recovery", () => {
  it("returns generic keyword tokens for words like obj, endobj, R, stream", () => {
    const tokens = lex("12 0 obj 14 0 R endobj stream");
    const kinds = tokens.map((t) => t.kind);
    expect(kinds).toEqual([
      "integer",
      "integer",
      "keyword",
      "integer",
      "integer",
      "keyword",
      "keyword",
      "keyword",
      "eof",
    ]);
    const keywordValues = tokens
      .filter(
        (t): t is { kind: "keyword"; value: string; range: { start: number; end: number } } =>
          t.kind === "keyword",
      )
      .map((t) => t.value);
    expect(keywordValues).toEqual(["obj", "R", "endobj", "stream"]);
  });

  it("emits an error token for a stray '>' and continues", () => {
    const tokens = lex("> 42");
    expect(tokens[0]?.kind).toBe("error");
    expect(tokens[1]?.kind).toBe("integer");
    expect(tokens.at(-1)?.kind).toBe("eof");
  });

  it("emits an error token for an unterminated literal string", () => {
    const tokens = lex("(no closing");
    expect(tokens[0]?.kind).toBe("error");
    expect(tokens[0]).toMatchObject({ message: expect.stringContaining("Unterminated") });
  });

  it("emits an error token for an unterminated hex string", () => {
    const tokens = lex("<deadbe");
    expect(tokens[0]?.kind).toBe("error");
  });

  it("emits an error token for invalid hex string content", () => {
    const tokens = lex("<dead!!beef>");
    expect(tokens[0]?.kind).toBe("error");
    expect(tokens[0]).toMatchObject({ message: expect.stringContaining("invalid") });
  });

  it("name with malformed #XX leaves the next delimiter intact", () => {
    // /A#2/B should produce error (for /A#) and then re-tokenize what is left:
    // the `2` byte becomes an integer, the `/B` becomes a fresh name.
    // Critically, the second `/` must NOT be consumed by the recovery —
    // otherwise we lose the next name entirely.
    const tokens = lex("/A#2/B");
    expect(tokens[0]?.kind).toBe("error");
    expect(tokens.find((t) => t.kind === "name")).toMatchObject({ value: "B" });
  });

  it("does not infinite-loop on arbitrary bytes", () => {
    const bytes = Uint8Array.from([0x00, 0x7f, 0x00]);
    const tokens = tokenizeAll(bytes);
    expect(tokens.at(-1)?.kind).toBe("eof");
  });
});
