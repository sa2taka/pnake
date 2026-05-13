/**
 * Recovery helper used when the xref chain is unusable.
 *
 * Walks the whole file with the lexer and records every
 * (integer, integer, keyword "obj") triple, producing a synthetic
 * xref entry table that other PDF readers (qpdf, PDF.js) also fall
 * back to. The result loses the "free entry" notion — anything
 * found by scanning is treated as in-use.
 */

import { Lexer } from "../lex/lexer";
import type { ByteReader } from "../io/byte-reader";
import type { PdfXrefEntry } from "../../../shared/ir-types";
import type { Token } from "../lex/tokens";

export function scanIndirectObjectHeaders(reader: ByteReader): PdfXrefEntry[] {
  reader.seek(0);
  const lexer = new Lexer(reader);
  const out: PdfXrefEntry[] = [];
  const buffer: Token[] = [];

  // Guard rail: emit at most this many entries to bound work on
  // pathological input. 200k is far above any realistic PDF.
  const HARD_LIMIT = 200_000;

  while (out.length < HARD_LIMIT) {
    const tok = lexer.next();
    if (tok.kind === "eof") break;
    buffer.push(tok);
    if (buffer.length > 3) buffer.shift();
    if (buffer.length === 3) {
      const a = buffer[0]!;
      const b = buffer[1]!;
      const c = buffer[2]!;
      if (
        a.kind === "integer" &&
        b.kind === "integer" &&
        c.kind === "keyword" &&
        c.value === "obj" &&
        a.value >= 0 &&
        b.value >= 0
      ) {
        out.push({
          objectNumber: a.value,
          generation: b.value,
          type: "n",
          offset: a.range.start,
        });
        // Reset the look-back so we don't accidentally re-match an obj
        // inside a stream that happens to contain integer integer "obj".
        buffer.length = 0;
      }
    }
  }
  return out;
}
