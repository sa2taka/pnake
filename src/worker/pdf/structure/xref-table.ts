/**
 * Classic xref table parser (ISO 32000-2 §7.5.4).
 *
 * Subsection layout:
 *   N M
 *   nnnnnnnnnn ggggg n␊
 *   ...
 *   trailer
 *   << ... >>
 *
 * We accept the canonical 20-byte entry shape but also tolerate the
 * common bug where the trailing newline is LF instead of CR LF — the
 * spec actually allows several line-ending variations.
 *
 * Recovery: malformed entries become free entries (gen 65535) and a
 * warning bubbles up; the parser keeps reading the remaining
 * subsections so the rest of the file can still be inspected.
 */

import { asciiString, isWhitespace, toBytes } from "../io/byte-reader";
import { Lexer } from "../lex/lexer";
import { TokenStream } from "../lex/token-stream";
import { ValueParser } from "../parse/value-parser";
import type { ByteReader} from "../io/byte-reader";
import type {
  ByteRange,
  PdfDict,
  PdfTrailer,
  PdfWarning,
  PdfXref,
  PdfXrefEntry,
} from "../../../shared/ir-types";

const KW_XREF = toBytes("xref");
const KW_TRAILER = toBytes("trailer");

export type XrefAndTrailer = {
  xref: PdfXref;
  trailer: PdfTrailer;
  warnings: PdfWarning[];
}

export function parseXrefAndTrailer(reader: ByteReader, offset: number): XrefAndTrailer {
  reader.seek(offset);
  reader.skipWhile(isWhitespace);
  const xrefStart = reader.pos;
  if (!reader.consumeIf(KW_XREF)) {
    throw new Error(`Expected "xref" at offset ${offset}`);
  }
  // After "xref" there should be exactly one whitespace; trim freely.
  reader.skipWhile(isWhitespace);

  const entries: PdfXrefEntry[] = [];
  const warnings: PdfWarning[] = [];

  while (true) {
    const beforeSubsection = reader.pos;
    // Stop when the next non-whitespace word is "trailer".
    if (reader.startsWith(KW_TRAILER)) break;

    // Read "first count" subsection header. Pull two integers via the lexer.
    const lexer = new Lexer(reader);
    const tokens = new TokenStream(lexer);
    const firstTok = tokens.consume();
    const countTok = tokens.consume();
    if (firstTok.kind !== "integer" || countTok.kind !== "integer") {
      warnings.push({
        id: warningId("xref-subsection-header", beforeSubsection),
        severity: "error",
        category: "xref",
        message: "Unexpected tokens in xref subsection header",
        byteRange: { start: beforeSubsection, end: reader.pos },
      });
      break;
    }

    // After the count integer the spec mandates a single whitespace
    // followed by `count` fixed-width entries. Use the position of the
    // count token's end rather than the lexer's current pos to avoid
    // crossing into the first entry by mistake.
    reader.seek(countTok.range.end);
    // Skip exactly one whitespace; some writers emit just LF.
    if (isWhitespace(reader.peek() ?? -1)) reader.advance(1);

    const first = firstTok.value;
    const count = countTok.value;
    for (let i = 0; i < count; i++) {
      const entryStart = reader.pos;
      if (entryStart + 20 > reader.end) {
        warnings.push({
          id: warningId("xref-entry-truncated", entryStart),
          severity: "error",
          category: "xref",
          message: "Truncated xref entry",
          byteRange: { start: entryStart, end: reader.end },
        });
        break;
      }
      const slice = reader.subview(entryStart, entryStart + 20);
      const parsed = parseXrefEntry(slice, first + i, entryStart);
      if (parsed.warning) warnings.push(parsed.warning);
      entries.push(parsed.entry);
      reader.seek(entryStart + 20);
    }

    reader.skipWhile(isWhitespace);
  }

  // Read trailer.
  reader.skipWhile(isWhitespace);
  if (!reader.consumeIf(KW_TRAILER)) {
    throw new Error(`Expected "trailer" after xref subsections, at ${reader.pos}`);
  }
  const trailerStart = reader.pos - KW_TRAILER.length;
  reader.skipWhile(isWhitespace);
  const lexer = new Lexer(reader);
  const tokens = new TokenStream(lexer);
  const parser = new ValueParser(tokens);
  const dictValue = parser.parseValue();
  if (dictValue.kind !== "dict") {
    throw new Error(`Trailer must be a dictionary, got ${dictValue.kind}`);
  }
  const dict: PdfDict = dictValue.entries;
  const trailerEnd = reader.pos;

  const trailer: PdfTrailer = {
    range: { start: trailerStart, end: trailerEnd },
    dict,
  };
  const xref: PdfXref = {
    kind: "table",
    range: { start: xrefStart, end: reader.pos },
    entries,
  };

  return { xref, trailer, warnings };
}

// ---- Helpers ----

function parseXrefEntry(
  slice: Uint8Array,
  objectNumber: number,
  offset: number,
): { entry: PdfXrefEntry; warning?: PdfWarning } {
  const line = asciiString(slice);
  // Canonical: "nnnnnnnnnn ggggg n\r\n" or "... f\r\n"
  // We accept variants with LF / CRLF / single trailing space.
  const m = /^(\d{10}) (\d{5}) ([nf])/.exec(line);
  if (!m) {
    return {
      entry: {
        objectNumber,
        generation: 65535,
        type: "f",
      },
      warning: {
        id: warningId("xref-entry-malformed", offset),
        severity: "warn",
        category: "xref",
        message: `Malformed xref entry: ${JSON.stringify(line)}`,
        byteRange: { start: offset, end: offset + slice.length },
      },
    };
  }
  const off = Number.parseInt(m[1]!, 10);
  const gen = Number.parseInt(m[2]!, 10);
  const flag = m[3]!;
  if (flag === "n") {
    return {
      entry: { objectNumber, generation: gen, type: "n", offset: off },
    };
  }
  return {
    entry: { objectNumber, generation: gen, type: "f", offset: off },
  };
}

function warningId(label: string, offset: number): string {
  return `warn:${label}:${offset.toString(16)}`;
}

// ---- startxref / EOF locator ----

const KW_STARTXREF = toBytes("startxref");
const KW_EOF = toBytes("%%EOF");

export function findStartxref(reader: ByteReader): number | null {
  // Per ISO 32000-2 §7.5.5, the trailer ends with `startxref offset %%EOF`.
  // We search the last 4 KB for the most recent startxref (covers nearly
  // every real file while keeping the scan bounded).
  const tailSize = Math.min(4096, reader.end);
  const start = reader.end - tailSize;
  const idx = reader.lastIndexOf(KW_STARTXREF, reader.end);
  if (idx === -1 || idx < start) return null;

  reader.seek(idx + KW_STARTXREF.length);
  reader.skipWhile(isWhitespace);
  const lexer = new Lexer(reader);
  const tok = lexer.next();
  if (tok.kind !== "integer") return null;
  return tok.value;
}

export function findEofMarkers(reader: ByteReader): ByteRange[] {
  const ranges: ByteRange[] = [];
  let pos = 0;
  while (true) {
    const idx = reader.indexOf(KW_EOF, pos);
    if (idx === -1) break;
    ranges.push({ start: idx, end: idx + KW_EOF.length });
    pos = idx + KW_EOF.length;
  }
  return ranges;
}

export { KW_XREF, KW_TRAILER, KW_STARTXREF, KW_EOF };
