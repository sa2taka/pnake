/**
 * Parse PdfValue from a token stream.
 *
 * Handles dicts, arrays, primitives, and the special "N G R" reference
 * form (three tokens of lookahead). Streams are recognized but their
 * data extraction lives in object-reader (which knows the source
 * ByteReader and can deal with /Length and the trailing endstream
 * keyword).
 */

import type { ObjectId, PdfDict, PdfFilter, PdfValue, StreamHandle } from "../../../shared/ir-types";
import { objectId } from "../../../shared/ir-types";
import type { Token } from "../lex/tokens";
import { TokenStream } from "../lex/token-stream";

export class ParseError extends Error {
  constructor(message: string, public token?: Token) {
    super(message);
    this.name = "ParseError";
  }
}

/**
 * Grammar context for ValueParser.
 *
 * `object` (default): PDF object syntax — bare `N G R` triples are
 * interpreted as indirect references (ISO 32000-2 §7.3.10).
 *
 * `content`: PDF content stream syntax — `R` is not a reserved word,
 * so we must NOT collapse `N G R` into a reference. (Real content
 * streams never emit refs; collapsing them silently mangles legal
 * input, e.g. an integer-integer-keyword sequence in operands.)
 */
export type ValueParserMode = "object" | "content";

export interface ValueParserOptions {
  mode?: ValueParserMode;
}

export class ValueParser {
  private readonly allowIndirectRef: boolean;

  constructor(public tokens: TokenStream, options: ValueParserOptions = {}) {
    this.allowIndirectRef = (options.mode ?? "object") === "object";
  }

  parseValue(): PdfValue {
    const tok = this.tokens.peek();
    switch (tok.kind) {
      case "true":
        this.tokens.consume();
        return { kind: "bool", value: true, range: tok.range };
      case "false":
        this.tokens.consume();
        return { kind: "bool", value: false, range: tok.range };
      case "null":
        this.tokens.consume();
        return { kind: "null", range: tok.range };
      case "name":
        this.tokens.consume();
        return { kind: "name", value: tok.value, range: tok.range };
      case "stringLiteral":
        this.tokens.consume();
        return { kind: "string", raw: tok.value, range: tok.range };
      case "stringHex":
        this.tokens.consume();
        return { kind: "string", raw: tok.value, hex: true, range: tok.range };
      case "real":
        this.tokens.consume();
        return { kind: "real", value: tok.value, range: tok.range };
      case "integer": {
        if (this.allowIndirectRef) {
          // Possible "N G R" reference. 3-token lookahead.
          const a = this.tokens.peek();
          const b = this.tokens.peek(1);
          const c = this.tokens.peek(2);
          if (
            a.kind === "integer" &&
            b.kind === "integer" &&
            c.kind === "keyword" &&
            c.value === "R" &&
            a.value >= 0 &&
            b.value >= 0
          ) {
            this.tokens.consume();
            this.tokens.consume();
            this.tokens.consume();
            return {
              kind: "ref",
              target: objectId(a.value, b.value),
              range: { start: a.range.start, end: c.range.end },
            };
          }
        }
        this.tokens.consume();
        return { kind: "int", value: tok.value, range: tok.range };
      }
      case "arrayStart":
        return this.parseArray();
      case "dictStart":
        return this.parseDict();
      case "eof":
        throw new ParseError("Unexpected EOF while parsing value", tok);
      default:
        // keyword / error / dictEnd / arrayEnd are not legal start-of-value tokens.
        throw new ParseError(`Unexpected token ${tok.kind} while parsing value`, tok);
    }
  }

  private parseArray(): PdfValue {
    const openTok = this.tokens.consume(); // [
    const items: PdfValue[] = [];
    while (true) {
      const next = this.tokens.peek();
      if (next.kind === "arrayEnd") {
        const close = this.tokens.consume();
        return {
          kind: "array",
          items,
          range: { start: openTok.range.start, end: close.range.end },
        };
      }
      if (next.kind === "eof") {
        throw new ParseError("Unterminated array", next);
      }
      items.push(this.parseValue());
    }
  }

  private parseDict(): PdfValue {
    const openTok = this.tokens.consume(); // <<
    const entries: PdfDict = {};
    while (true) {
      const next = this.tokens.peek();
      if (next.kind === "dictEnd") {
        const close = this.tokens.consume();
        return {
          kind: "dict",
          entries,
          range: { start: openTok.range.start, end: close.range.end },
        };
      }
      if (next.kind === "eof") {
        throw new ParseError("Unterminated dictionary", next);
      }
      if (next.kind !== "name") {
        throw new ParseError(`Expected name as dict key, got ${next.kind}`, next);
      }
      const keyToken = this.tokens.consume() as Token & { kind: "name"; value: string };
      const value = this.parseValue();
      entries[keyToken.value] = value;
    }
  }
}

// =============================================================================
// Helpers for downstream code
// =============================================================================

export function expectInt(value: PdfValue | undefined): number | undefined {
  if (!value) return undefined;
  if (value.kind === "int") return value.value;
  if (value.kind === "real") return Math.trunc(value.value);
  return undefined;
}

export function expectName(value: PdfValue | undefined): string | undefined {
  if (value && value.kind === "name") return value.value;
  return undefined;
}

export function expectArray(value: PdfValue | undefined): PdfValue[] | undefined {
  if (value && value.kind === "array") return value.items;
  return undefined;
}

export function expectRef(value: PdfValue | undefined): ObjectId | undefined {
  if (value && value.kind === "ref") return value.target;
  return undefined;
}

/**
 * Best-effort filter-chain extraction from a stream dictionary.
 * Returns a list of filter identifiers, or null if /Filter is absent.
 */
export function extractFilters(dict: PdfDict): PdfFilter[] {
  const entry = dict["Filter"] ?? dict["F"];
  if (!entry) return [];
  const names = entry.kind === "array" ? entry.items : [entry];
  const out: PdfFilter[] = [];
  for (const item of names) {
    if (item.kind !== "name") continue;
    out.push(asFilter(item.value));
  }
  return out;
}

const KNOWN_FILTERS: ReadonlySet<string> = new Set([
  "FlateDecode",
  "DCTDecode",
  "JPXDecode",
  "CCITTFaxDecode",
  "LZWDecode",
  "ASCII85Decode",
  "ASCIIHexDecode",
  "RunLengthDecode",
  "JBIG2Decode",
  "Crypt",
]);

function asFilter(name: string): PdfFilter {
  if (KNOWN_FILTERS.has(name)) return name as PdfFilter;
  // Spec also supports the short forms /Fl /A85 /AHx /LZW /CCF /DCT /RL.
  const SHORT: Record<string, PdfFilter> = {
    A85: "ASCII85Decode",
    AHx: "ASCIIHexDecode",
    Fl: "FlateDecode",
    LZW: "LZWDecode",
    CCF: "CCITTFaxDecode",
    DCT: "DCTDecode",
    RL: "RunLengthDecode",
  };
  if (SHORT[name]) return SHORT[name]!;
  return { kind: "unknown", name };
}

export type { StreamHandle };
