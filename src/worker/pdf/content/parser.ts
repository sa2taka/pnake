/**
 * Content stream parser — turns a decoded content stream into the
 * ordered list of PdfOperation values that the UI's "Content" view
 * and the upcoming graphics-state simulator consume.
 *
 * Strategy:
 *   - Reuse the byte/lexer pipeline so byte ranges flow through.
 *   - Stack operands; on a keyword token, emit one operation and
 *     reset the stack.
 *   - Inline images (BI / ID / EI) get folded into a single
 *     synthetic operation so the trailing binary data does not break
 *     tokenization.
 *
 * Categorization is added in a separate commit; every operation here
 * starts with category="unknown" and the post-processor labels them.
 */

import { operationId } from "../../../shared/ir-types";
import { ByteReader, asciiString, isWhitespace, toBytes } from "../io/byte-reader";
import { Lexer } from "../lex/lexer";
import { TokenStream } from "../lex/token-stream";
import { ParseError, ValueParser } from "../parse/value-parser";
import { categorizeOperator } from "./categories";
import type { PdfDict, PdfOperation, PdfValue, PdfWarning } from "../../../shared/ir-types";

const KW_BI = "BI";
const KW_ID = "ID";

const EI_PATTERN = toBytes("EI");

export type ContentStreamParseResult = {
  operations: PdfOperation[];
  warnings: PdfWarning[];
}

export type ParseContentStreamOptions = {
  /**
   * Map from /Properties resource name (e.g. "P1") to its property dict.
   * Used when a BDC operator references the property list by name instead
   * of supplying an inline dict (ISO 32000-2 §14.6.2). Pass the resolved
   * resources.properties from PdfResolvedResources here.
   */
  properties?: Record<string, PdfDict>;
}

export function parseContentStream(
  decoded: Uint8Array,
  pageNumber: number,
  options: ParseContentStreamOptions = {},
): ContentStreamParseResult {
  const reader = new ByteReader(decoded);
  const lexer = new Lexer(reader);
  const tokens = new TokenStream(lexer);
  // `mode: "content"` disables the indirect-reference lookahead.
  // Content streams never emit refs (R is just any other operator);
  // collapsing "1 0 R" inside an operand triple would silently corrupt
  // legal integer-integer-keyword sequences.
  const parser = new ValueParser(tokens, { mode: "content" });
  const properties = options.properties ?? {};
  const ops: PdfOperation[] = [];
  const warnings: PdfWarning[] = [];

  let stack: PdfValue[] = [];
  let seq = 0;
  let stackStart = 0;
  /** MCID stack tracked through BDC / EMC; only innermost wins per spec. */
  const mcidStack: (number | undefined)[] = [];

  while (true) {
    const peek = tokens.peek();
    if (peek.kind === "eof") break;
    if (peek.kind === "error") {
      tokens.consume();
      continue;
    }
    if (peek.kind === "keyword") {
      tokens.consume();
      const opStart = stack.length > 0 ? stackStart : peek.range.start;
      if (peek.value === KW_BI) {
        const op = consumeInlineImage(reader, tokens, lexer, opStart, pageNumber, seq, warnings);
        ops.push(op);
        seq++;
        stack = [];
        continue;
      }
      const activeMcid = mcidStack.length > 0 ? mcidStack[mcidStack.length - 1] : undefined;
      const operation: PdfOperation = {
        id: operationId(pageNumber, seq),
        sequence: seq++,
        operator: peek.value,
        operands: stack,
        category: categorizeOperator(peek.value),
        decodedRange: { start: opStart, end: peek.range.end },
      };
      if (activeMcid != null) operation.mcid = activeMcid;
      ops.push(operation);
      // BDC pushes /MCID from its second operand. The operand can be either
      // an inline dict ({ /MCID N }) or a name that references the page's
      // /Properties resource map. Both paths land here.
      if (peek.value === "BDC") {
        const second = stack[1];
        let pushed: number | undefined;
        if (second?.kind === "dict") {
          const mcid = second.entries.MCID;
          if (mcid?.kind === "int") pushed = mcid.value;
        } else if (second?.kind === "name") {
          const propDict = properties[second.value];
          if (propDict) {
            const mcid = propDict.MCID;
            if (mcid?.kind === "int") pushed = mcid.value;
          }
        }
        mcidStack.push(pushed);
      } else if (peek.value === "BMC") {
        mcidStack.push(undefined);
      } else if (peek.value === "EMC") {
        mcidStack.pop();
      }
      stack = [];
      continue;
    }
    // Operand: parse a value (handles primitives, arrays, dicts).
    try {
      if (stack.length === 0) stackStart = peek.range.start;
      const value = parser.parseValue();
      stack.push(value);
    } catch (err) {
      const range = peek.range;
      warnings.push({
        id: `warn:content-parse:${pageNumber}:${range.start}`,
        severity: "warn",
        category: "structure",
        message: `Content stream parse error at ${range.start}: ${(err as Error).message}`,
        byteRange: range,
      });
      // Skip the offending token to make progress.
      if (err instanceof ParseError) tokens.consume();
      else tokens.consume();
    }
  }

  return { operations: ops, warnings };
}

function consumeInlineImage(
  reader: ByteReader,
  tokens: TokenStream,
  _lexer: Lexer,
  biStart: number,
  pageNumber: number,
  sequence: number,
  warnings: PdfWarning[],
): PdfOperation {
  // Consume name/value pairs (operands stay on the stack but we don't
  // care — we'll fold them into the synthetic op) until we hit the
  // "ID" keyword.
  while (true) {
    const tok = tokens.peek();
    if (tok.kind === "eof") break;
    if (tok.kind === "keyword" && tok.value === KW_ID) {
      tokens.consume();
      break;
    }
    tokens.consume();
  }

  // Image data starts after a single whitespace following ID. Scan
  // forward for the next whitespace-bounded "EI" keyword, then verify
  // the bytes after it parse as a plausible operator boundary — this
  // pushes back on JPEG / Flate payloads that contain the literal
  // "EI" surrounded by whitespace-shaped bytes.
  tokens.reset();
  reader.skipWhile(isWhitespace);
  const dataStart = reader.pos;
  let eiOffset = -1;
  let scanFrom = dataStart;
  while (true) {
    const candidate = reader.indexOf(EI_PATTERN, scanFrom);
    if (candidate === -1) break;
    if (looksLikeEiBoundary(reader, candidate)) {
      eiOffset = candidate;
      break;
    }
    scanFrom = candidate + 1;
  }
  if (eiOffset === -1) {
    // Could not find a plausible EI. Don't swallow the rest of the page;
    // back up to the start of the image data so the surrounding loop can
    // re-tokenize it (it may still produce garbage, but that's recoverable).
    warnings.push({
      id: `warn:inline-image-ei:${pageNumber}:${biStart}`,
      severity: "warn",
      category: "structure",
      message: `Inline image starting at ${biStart} has no parseable EI terminator`,
    });
    reader.seek(dataStart);
    return {
      id: operationId(pageNumber, sequence),
      sequence,
      operator: "BI/EI",
      operands: [],
      category: "image-inline",
      decodedRange: { start: biStart, end: dataStart },
    };
  }
  reader.seek(eiOffset + EI_PATTERN.length);
  return {
    id: operationId(pageNumber, sequence),
    sequence,
    operator: "BI/EI",
    operands: [],
    category: "image-inline",
    decodedRange: { start: biStart, end: reader.pos },
  };
}

/**
 * Strict boundary check around an `EI` candidate. The byte before must be
 * whitespace (preferably EOL); the bytes after must look like a fresh
 * operator boundary — whitespace + another keyword / operand start, or EOF.
 * This rejects the common false positives where binary stream data happens
 * to contain `\x20EI\x20`.
 */
function looksLikeEiBoundary(reader: ByteReader, idx: number): boolean {
  const before = reader.bytes[idx - 1];
  const after = reader.bytes[idx + EI_PATTERN.length];
  if (before !== undefined && !isWhitespace(before)) return false;
  if (after === undefined) return true; // EOF after EI is fine
  if (!isWhitespace(after)) return false;
  // Peek a little further: we want the next non-whitespace byte to look
  // like the start of an operator (letter / digit / sign / paren / slash /
  // bracket / less-than) rather than another random binary byte.
  for (let i = idx + EI_PATTERN.length; i < reader.bytes.length && i < idx + 16; i++) {
    const b = reader.bytes[i];
    if (b === undefined) return true;
    if (isWhitespace(b)) continue;
    return looksLikeOperatorStart(b);
  }
  return true;
}

function looksLikeOperatorStart(b: number): boolean {
  if (b >= 0x41 && b <= 0x5a) return true; // A-Z
  if (b >= 0x61 && b <= 0x7a) return true; // a-z
  if (b >= 0x30 && b <= 0x39) return true; // 0-9
  return (
    b === 0x2b || // +
    b === 0x2d || // -
    b === 0x2e || // .
    b === 0x2f || // /
    b === 0x28 || // (
    b === 0x3c || // <
    b === 0x5b || // [
    b === 0x25 // %
  );
}

export { asciiString };
