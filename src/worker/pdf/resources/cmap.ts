/**
 * ToUnicode CMap decoder (Adobe TN 5099 / ISO 32000-2 §9.10.3).
 *
 * Covers the bfchar / bfrange subset, which is what every TTF / OTF
 * font subset I have seen actually uses. The grammar around codespace
 * ranges, beginbfrange "array" replacement, and CID hex codes of
 * length 1–4 bytes is handled. Notdef ranges and arbitrary
 * adobe-glyph-list mappings are not parsed yet — they emit a warning
 * via the value parser if encountered.
 */

import type { PdfWarning } from "../../../shared/ir-types";
import { ByteReader, asciiString } from "../io/byte-reader";
import { Lexer } from "../lex/lexer";
import { TokenStream } from "../lex/token-stream";

export interface CodespaceRange {
  /** Byte width of codes in this range (1–4). */
  width: number;
  /** Inclusive lower bound as big-endian uint. */
  start: number;
  /** Inclusive upper bound as big-endian uint. */
  end: number;
}

export interface ToUnicodeCMap {
  /** Map from character code (1–4 byte big-endian uint) to a Unicode string. */
  entries: Map<number, string>;
  /** Source byte ranges hex strings can have. Most PDFs use 2-byte codes. */
  codeByteLengths: Set<number>;
  /** Declared codespace ranges from begincodespacerange / endcodespacerange. */
  codespaceRanges: CodespaceRange[];
  warnings: PdfWarning[];
}

export function parseToUnicodeCMap(decoded: Uint8Array): ToUnicodeCMap {
  const reader = new ByteReader(decoded);
  const lexer = new Lexer(reader);
  const tokens = new TokenStream(lexer);
  const entries = new Map<number, string>();
  const codeByteLengths = new Set<number>();
  const codespaceRanges: CodespaceRange[] = [];
  const warnings: PdfWarning[] = [];

  while (true) {
    const tok = tokens.peek();
    if (tok.kind === "eof") break;
    if (tok.kind === "keyword") {
      if (tok.value === "beginbfchar") {
        tokens.consume();
        parseBfchar(tokens, entries, codeByteLengths, warnings);
        continue;
      }
      if (tok.value === "beginbfrange") {
        tokens.consume();
        parseBfrange(tokens, entries, codeByteLengths, warnings);
        continue;
      }
      if (tok.value === "begincodespacerange") {
        tokens.consume();
        parseCodespaceRange(tokens, codespaceRanges, codeByteLengths, warnings);
        continue;
      }
    }
    tokens.consume();
  }

  return { entries, codeByteLengths, codespaceRanges, warnings };
}

function parseCodespaceRange(
  tokens: TokenStream,
  ranges: CodespaceRange[],
  codeByteLengths: Set<number>,
  warnings: PdfWarning[],
): void {
  while (true) {
    const tok = tokens.peek();
    if (tok.kind === "eof") break;
    if (tok.kind === "keyword" && tok.value === "endcodespacerange") {
      tokens.consume();
      return;
    }
    const startTok = tokens.consume();
    const endTok = tokens.consume();
    if (startTok.kind !== "stringHex" || endTok.kind !== "stringHex") {
      warnings.push({
        id: `warn:cmap-codespace:${startTok.range.start}`,
        severity: "warn",
        category: "encoding",
        message: "Unexpected token in codespacerange",
      });
      continue;
    }
    const width = startTok.value.length;
    codeByteLengths.add(width);
    ranges.push({
      width,
      start: readBigEndian(startTok.value),
      end: readBigEndian(endTok.value),
    });
  }
}

function parseBfchar(
  tokens: TokenStream,
  entries: Map<number, string>,
  codeByteLengths: Set<number>,
  warnings: PdfWarning[],
): void {
  while (true) {
    const tok = tokens.peek();
    if (tok.kind === "eof") break;
    if (tok.kind === "keyword" && tok.value === "endbfchar") {
      tokens.consume();
      return;
    }
    const codeTok = tokens.consume();
    const targetTok = tokens.consume();
    if (codeTok.kind !== "stringHex" || targetTok.kind !== "stringHex") {
      warnings.push({
        id: `warn:cmap-bfchar:${codeTok.range.start}`,
        severity: "warn",
        category: "encoding",
        message: "Unexpected token in bfchar mapping",
      });
      continue;
    }
    const code = readBigEndian(codeTok.value);
    codeByteLengths.add(codeTok.value.length);
    entries.set(code, decodeUtf16BE(targetTok.value));
  }
}

function parseBfrange(
  tokens: TokenStream,
  entries: Map<number, string>,
  codeByteLengths: Set<number>,
  warnings: PdfWarning[],
): void {
  while (true) {
    const tok = tokens.peek();
    if (tok.kind === "eof") break;
    if (tok.kind === "keyword" && tok.value === "endbfrange") {
      tokens.consume();
      return;
    }
    const startTok = tokens.consume();
    const endTok = tokens.consume();
    const targetTok = tokens.consume();
    if (startTok.kind !== "stringHex" || endTok.kind !== "stringHex") {
      warnings.push({
        id: `warn:cmap-bfrange-bounds:${startTok.range.start}`,
        severity: "warn",
        category: "encoding",
        message: "Unexpected bounds in bfrange",
      });
      continue;
    }
    const start = readBigEndian(startTok.value);
    const end = readBigEndian(endTok.value);
    codeByteLengths.add(startTok.value.length);
    if (targetTok.kind === "stringHex") {
      const baseChars = utf16Codes(targetTok.value);
      for (let cid = start; cid <= end; cid++) {
        const offset = cid - start;
        const chars = baseChars.slice();
        const last = chars.length - 1;
        if (last >= 0) chars[last] = (chars[last]! + offset) & 0xffff;
        entries.set(cid, String.fromCharCode(...chars));
      }
      continue;
    }
    if (targetTok.kind === "arrayStart") {
      // The single-line `[<a><b>...]` form: each successive code maps to a
      // sequential entry in the array.
      let cid = start;
      while (true) {
        const next = tokens.peek();
        if (next.kind === "arrayEnd") {
          tokens.consume();
          break;
        }
        if (next.kind === "stringHex") {
          tokens.consume();
          entries.set(cid++, decodeUtf16BE(next.value));
        } else {
          tokens.consume();
        }
      }
      continue;
    }
    warnings.push({
      id: `warn:cmap-bfrange-target:${targetTok.range.start}`,
      severity: "warn",
      category: "encoding",
      message: `Unexpected bfrange target ${targetTok.kind}`,
    });
  }
}

// =============================================================================
// Apply a CMap to decode a glyph-encoded string
// =============================================================================

export function decodeWithCMap(
  cmap: ToUnicodeCMap,
  bytes: Uint8Array,
  fallbackBytes = 2,
): string {
  const widths = cmap.codeByteLengths.size > 0 ? Array.from(cmap.codeByteLengths) : [fallbackBytes];
  widths.sort((a, b) => b - a); // try longest first
  let i = 0;
  let out = "";
  while (i < bytes.length) {
    let matched = false;
    for (const w of widths) {
      if (i + w > bytes.length) continue;
      const code = readBigEndian(bytes.subarray(i, i + w));
      const text = cmap.entries.get(code);
      if (text !== undefined) {
        out += text;
        i += w;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // No bfchar/bfrange entry hit. Advance by the codespace-declared width
      // when we have one (so multibyte CMaps don't desync), else by one byte.
      const width = codespaceWidthFor(cmap, bytes, i) ?? 1;
      out += "�";
      i += width;
    }
  }
  return out;
}

function codespaceWidthFor(
  cmap: ToUnicodeCMap,
  bytes: Uint8Array,
  offset: number,
): number | undefined {
  if (cmap.codespaceRanges.length === 0) return undefined;
  // Try each range — longest first — and pick the one whose declared width
  // fits the remaining bytes AND whose [start, end] contains the prefix.
  const ranges = [...cmap.codespaceRanges].sort((a, b) => b.width - a.width);
  for (const range of ranges) {
    if (offset + range.width > bytes.length) continue;
    const code = readBigEndian(bytes.subarray(offset, offset + range.width));
    if (code >= range.start && code <= range.end) return range.width;
  }
  return undefined;
}

// =============================================================================
// Helpers
// =============================================================================

function readBigEndian(bytes: Uint8Array): number {
  let acc = 0;
  for (let i = 0; i < bytes.length; i++) acc = (acc << 8) | (bytes[i] ?? 0);
  return acc >>> 0;
}

function utf16Codes(bytes: Uint8Array): number[] {
  const codes: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    codes.push(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
  }
  return codes;
}

function decodeUtf16BE(bytes: Uint8Array): string {
  return String.fromCharCode(...utf16Codes(bytes));
}

// Re-export for the value parser side.
export { asciiString };
