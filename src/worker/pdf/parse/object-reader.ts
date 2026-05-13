/**
 * Indirect object reader — given a byte offset, parses `N G obj … endobj`.
 *
 * Stream bodies are NOT decoded here; the reader only locates the byte
 * range that contains the stream data and produces a StreamHandle.
 * Decoding is the responsibility of the stream/filter pipeline (added
 * in a later commit).
 *
 * Length resolution policy:
 *  - If /Length is an integer literal in the dict, trust it.
 *  - If /Length is missing or is an indirect reference, scan forward
 *    for an `endstream` keyword preceded by whitespace.
 */

import type {
  ByteRange,
  ObjectId,
  PdfDict,
  PdfValue,
  PdfWarning,
} from "../../../shared/ir-types";
import { objectId } from "../../../shared/ir-types";
import { ByteReader, isEol, isWhitespace, toBytes } from "../io/byte-reader";
import { Lexer } from "../lex/lexer";
import { TokenStream } from "../lex/token-stream";
import {
  ParseError,
  ValueParser,
  expectInt,
  extractFilters,
} from "./value-parser";

export interface IndirectObject {
  id: ObjectId;
  number: number;
  generation: number;
  range: ByteRange;
  value: PdfValue;
  streamRange?: ByteRange;
  /**
   * Issues encountered while reading this object. Populated for "weird
   * but readable" cases (e.g. missing `endobj` keyword) — fatal errors
   * still throw ParseError. Callers (manifest.loadObjects) merge these
   * into the analysis-wide warnings list.
   */
  warnings?: PdfWarning[];
}

const KW_OBJ = toBytes("obj");
const KW_ENDOBJ = toBytes("endobj");
const KW_STREAM = toBytes("stream");
const KW_ENDSTREAM = toBytes("endstream");

export class IndirectObjectReader {
  constructor(public reader: ByteReader) {}

  readAt(offset: number): IndirectObject {
    this.reader.seek(offset);
    const lexer = new Lexer(this.reader);
    const tokens = new TokenStream(lexer);

    const numTok = tokens.consume();
    const genTok = tokens.consume();
    const objKw = tokens.consume();
    if (
      numTok.kind !== "integer" ||
      genTok.kind !== "integer" ||
      objKw.kind !== "keyword" ||
      objKw.value !== "obj"
    ) {
      throw new ParseError(
        `Not an indirect object header at offset ${offset}: got ${numTok.kind} ${genTok.kind} ${objKw.kind}`,
      );
    }

    const number = numTok.value;
    const generation = genTok.value;
    const start = numTok.range.start;

    const parser = new ValueParser(tokens);
    let value = parser.parseValue();

    // Optional: `stream` follows the value (dict). Spec requires CRLF or LF
    // right after the stream keyword.
    const after = tokens.peek();
    let streamRange: ByteRange | undefined;
    let endObjRange: { start: number; end: number };

    if (after.kind === "keyword" && after.value === "stream") {
      tokens.consume();
      // Spec: stream data begins immediately after the EOL following "stream".
      // Buffer flush — reader.pos is now somewhere past the keyword.
      const reader = this.reader;
      // Skip exactly one EOL (LF or CRLF) — but tolerate other whitespace.
      skipSingleEol(reader);

      const dataStart = reader.pos;
      const dict = value.kind === "dict" ? value.entries : undefined;
      const literalLength = dict ? expectInt(dict["Length"]) : undefined;

      let dataEnd: number;
      let trustedLength = false;
      if (literalLength != null && literalLength >= 0 && dataStart + literalLength <= reader.end) {
        // Sanity check: the byte right after `dataStart + literalLength`
        // should be whitespace followed by `endstream`. If not, fall back to
        // scanning so we recover from off-by-one /Length values.
        const candidateEnd = dataStart + literalLength;
        reader.seek(candidateEnd);
        reader.skipWhile(isWhitespace);
        if (reader.startsWith(KW_ENDSTREAM)) {
          dataEnd = candidateEnd;
          trustedLength = true;
        } else {
          reader.seek(dataStart);
          dataEnd = scanForEndstream(reader, dataStart, number, generation);
        }
      } else {
        dataEnd = scanForEndstream(reader, dataStart, number, generation);
      }
      // Trim trailing EOL bytes from the data range, but only when we found
      // endstream via scanning — trust the /Length value otherwise.
      if (!trustedLength) {
        while (dataEnd > dataStart) {
          const b = reader.bytes[dataEnd - 1];
          if (b === undefined || !isEol(b)) break;
          dataEnd--;
        }
      }
      reader.seek(dataEnd);
      streamRange = { start: dataStart, end: dataEnd };

      // Consume endstream keyword.
      tokens.reset();
      reader.skipWhile(isWhitespace);
      if (!reader.consumeIf(KW_ENDSTREAM)) {
        throw new ParseError(`Expected endstream for object ${number} ${generation}`);
      }

      // Turn the dict value into a stream value carrying a handle.
      const dictEntries = value.kind === "dict" ? value.entries : ({} as PdfDict);
      value = {
        kind: "stream",
        dict: dictEntries,
        handle: {
          objectRef: objectId(number, generation),
          filters: extractFilters(dictEntries),
          length: dataEnd - dataStart,
        },
      };
    }

    // Consume endobj.
    tokens.reset();
    const consumed = consumeKeyword(this.reader, KW_ENDOBJ);
    const warnings: PdfWarning[] = [];
    if (consumed) {
      endObjRange = { start: consumed.start, end: consumed.end };
    } else {
      endObjRange = { start: this.reader.pos, end: this.reader.pos };
      warnings.push({
        id: `warn:endobj-missing:${number}:${generation}`,
        severity: "warn",
        category: "structure",
        message: `Missing endobj keyword for object ${number} ${generation}`,
        byteRange: { start, end: this.reader.pos },
      });
    }

    const result: IndirectObject = {
      id: objectId(number, generation),
      number,
      generation,
      range: { start, end: endObjRange.end },
      value,
      ...(streamRange ? { streamRange } : {}),
    };
    if (warnings.length > 0) result.warnings = warnings;
    return result;
  }

  /**
   * Header-only: returns just the {number, generation, headerEnd} so a
   * cross-reference table can be built without parsing the value.
   */
  peekHeader(offset: number): { number: number; generation: number; headerEnd: number } | null {
    this.reader.seek(offset);
    const lexer = new Lexer(this.reader);
    const tokens = new TokenStream(lexer);
    const a = tokens.consume();
    const b = tokens.consume();
    const c = tokens.consume();
    if (a.kind !== "integer" || b.kind !== "integer" || c.kind !== "keyword" || c.value !== "obj") {
      return null;
    }
    return { number: a.value, generation: b.value, headerEnd: c.range.end };
  }
}

/**
 * Scan forward from `dataStart` for an `endstream` keyword whose
 * boundaries look right.
 *
 * The raw `indexOf("endstream")` form was a false-positive trap:
 * binary stream payloads can contain the byte sequence `endstream`
 * inside JPEG / Flate output and we would terminate the stream mid-
 * data. Per ISO 32000-2 §7.3.8.1, `endstream` must follow whitespace
 * and be followed by whitespace; we enforce both.
 *
 * We prefer EOL-prefixed candidates first (the spec-recommended
 * form). Only if those fail do we accept a generic whitespace
 * prefix.
 */
function scanForEndstream(
  reader: ByteReader,
  dataStart: number,
  number: number,
  generation: number,
): number {
  // First pass: require an EOL (\n / \r) directly before `endstream` and
  // delimiter / whitespace right after. This is what well-formed writers emit.
  const eolMatch = scanWithPrefix(reader, dataStart, isEol);
  if (eolMatch !== -1) return eolMatch;
  // Second pass: any whitespace before, as a recovery for malformed writers.
  const wsMatch = scanWithPrefix(reader, dataStart, isWhitespace);
  if (wsMatch !== -1) return wsMatch;
  throw new ParseError(
    `Missing endstream for object ${number} ${generation}`,
  );
}

function scanWithPrefix(
  reader: ByteReader,
  dataStart: number,
  isPrefix: (byte: number) => boolean,
): number {
  let from = dataStart;
  while (true) {
    const idx = reader.indexOf(KW_ENDSTREAM, from);
    if (idx === -1) return -1;
    if (idx === dataStart) {
      // Zero-length stream — accept without prefix check.
      return idx;
    }
    const prev = reader.bytes[idx - 1];
    const next = reader.bytes[idx + KW_ENDSTREAM.length];
    const prevOk = prev !== undefined && isPrefix(prev);
    const nextOk = next === undefined || isWhitespace(next) || next === 0x2f; // EOF, ws, or "/" (next object)
    if (prevOk && nextOk) return idx;
    from = idx + 1; // skip past this false positive and keep searching
  }
}

function skipSingleEol(reader: ByteReader): void {
  const b = reader.peek();
  if (b === 0x0d) {
    reader.advance(1);
    if (reader.peek() === 0x0a) reader.advance(1);
  } else if (b === 0x0a) {
    reader.advance(1);
  } else {
    // Tolerant: skip any whitespace before the data.
    reader.skipWhile(isWhitespace);
  }
}

function consumeKeyword(reader: ByteReader, keyword: Uint8Array): ByteRange | null {
  reader.skipWhile(isWhitespace);
  const start = reader.pos;
  if (!reader.consumeIf(keyword)) return null;
  return { start, end: reader.pos };
}

export { KW_OBJ, KW_ENDOBJ, KW_STREAM, KW_ENDSTREAM };
