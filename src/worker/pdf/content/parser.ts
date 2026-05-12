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

import type { PdfOperation, PdfValue, PdfWarning } from "../../../shared/ir-types";
import { operationId } from "../../../shared/ir-types";
import { ByteReader, asciiString, isWhitespace, toBytes } from "../io/byte-reader";
import { Lexer } from "../lex/lexer";
import { TokenStream } from "../lex/token-stream";
import { ParseError, ValueParser } from "../parse/value-parser";
import { categorizeOperator } from "./categories";

const KW_BI = "BI";
const KW_ID = "ID";

const EI_PATTERN = toBytes("EI");

export interface ContentStreamParseResult {
  operations: PdfOperation[];
  warnings: PdfWarning[];
}

export function parseContentStream(
  decoded: Uint8Array,
  pageNumber: number,
): ContentStreamParseResult {
  const reader = new ByteReader(decoded);
  const lexer = new Lexer(reader);
  const tokens = new TokenStream(lexer);
  // `mode: "content"` disables the indirect-reference lookahead.
  // Content streams never emit refs (R is just any other operator);
  // collapsing "1 0 R" inside an operand triple would silently corrupt
  // legal integer-integer-keyword sequences.
  const parser = new ValueParser(tokens, { mode: "content" });
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
    if (peek.kind === "comment" || peek.kind === "error") {
      tokens.consume();
      continue;
    }
    if (peek.kind === "keyword") {
      tokens.consume();
      const opStart = stack.length > 0 ? stackStart : peek.range.start;
      if (peek.value === KW_BI) {
        const op = consumeInlineImage(reader, tokens, lexer, opStart, pageNumber, seq);
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
      // BDC pushes /MCID from the dict operand; BMC pushes nothing.
      if (peek.value === "BDC") {
        const dict = stack[1];
        let pushed: number | undefined;
        if (dict?.kind === "dict") {
          const mcid = dict.entries.MCID;
          if (mcid?.kind === "int") pushed = mcid.value;
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
  // forward for the next whitespace-bounded "EI" keyword.
  tokens.reset();
  // The lexer may have buffered past the "ID" — restart scanning from
  // wherever the underlying reader left off after a manual reset.
  // Skip the mandatory single whitespace per spec, but tolerate any amount.
  reader.skipWhile(isWhitespace);
  let eiOffset = -1;
  let scanFrom = reader.pos;
  while (true) {
    const candidate = reader.indexOf(EI_PATTERN, scanFrom);
    if (candidate === -1) break;
    // EI must be preceded by whitespace and followed by whitespace.
    const before = reader.bytes[candidate - 1];
    const after = reader.bytes[candidate + 2];
    const beforeOk = before === undefined || isWhitespace(before);
    const afterOk = after === undefined || isWhitespace(after);
    if (beforeOk && afterOk) {
      eiOffset = candidate;
      break;
    }
    scanFrom = candidate + 1;
  }
  if (eiOffset === -1) {
    // Couldn't find EI; give up and treat the rest as image data.
    reader.seek(reader.end);
  } else {
    reader.seek(eiOffset + 2);
  }

  return {
    id: operationId(pageNumber, sequence),
    sequence,
    operator: "BI/EI",
    operands: [],
    category: "image-inline",
    decodedRange: { start: biStart, end: reader.pos },
  };
}

// Re-export ascii helper so tests can reuse it.
export { asciiString };
