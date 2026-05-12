/**
 * PDF token lexer.
 *
 * Faithful to ISO 32000-2 §7.2 (syntax) and §7.3 (objects), with the
 * following recovery posture:
 *  - on any malformed token, emit a single "error" token whose range
 *    covers the unparsable bytes and advance to the next reasonable
 *    boundary, then resume.
 *  - never throw from `next()`; throwing belongs to higher layers
 *    that can decide whether to keep going.
 *
 * The lexer is positional — give it a ByteReader and call `next()`
 * until an "eof" token is returned. Suitable for both object body
 * parsing and content-stream parsing (which uses a smaller subset).
 */

import {
  ByteReader,
  asciiString,
  isDelimiter,
  isDigit,
  isHex,
  isOctal,
  isRegular,
  isWhitespace,
} from "../io/byte-reader";
import type { Token } from "./tokens";

const CHAR_PERCENT = 0x25;
const CHAR_SLASH = 0x2f;
const CHAR_LPAREN = 0x28;
const CHAR_RPAREN = 0x29;
const CHAR_LT = 0x3c;
const CHAR_GT = 0x3e;
const CHAR_LBRACKET = 0x5b;
const CHAR_RBRACKET = 0x5d;
const CHAR_PLUS = 0x2b;
const CHAR_MINUS = 0x2d;
const CHAR_DOT = 0x2e;
const CHAR_BACKSLASH = 0x5c;
const CHAR_HASH = 0x23;
const CHAR_LF = 0x0a;
const CHAR_CR = 0x0d;
const CHAR_TAB = 0x09;
const CHAR_BS = 0x08;
const CHAR_FF = 0x0c;

export class Lexer {
  constructor(private reader: ByteReader) {}

  next(): Token {
    this.skipWhitespaceAndComments();
    if (this.reader.eof) {
      return { kind: "eof", range: { start: this.reader.pos, end: this.reader.pos } };
    }

    const start = this.reader.pos;
    const b = this.reader.peek();
    if (b === undefined) {
      return { kind: "eof", range: { start, end: start } };
    }

    if (b === CHAR_SLASH) return this.lexName(start);
    if (b === CHAR_LPAREN) return this.lexStringLiteral(start);
    if (b === CHAR_LT) return this.lexLtPrefix(start);
    if (b === CHAR_GT) return this.lexGtPrefix(start);
    if (b === CHAR_LBRACKET) {
      this.reader.advance(1);
      return { kind: "arrayStart", range: { start, end: this.reader.pos } };
    }
    if (b === CHAR_RBRACKET) {
      this.reader.advance(1);
      return { kind: "arrayEnd", range: { start, end: this.reader.pos } };
    }
    if (b === CHAR_PLUS || b === CHAR_MINUS || b === CHAR_DOT || isDigit(b)) {
      const num = this.tryLexNumber(start);
      if (num) return num;
    }
    return this.lexKeywordOrError(start);
  }

  // ---------------------------------------------------------------------------
  // Whitespace / comments
  // ---------------------------------------------------------------------------

  private skipWhitespaceAndComments(): void {
    while (!this.reader.eof) {
      this.reader.skipWhile(isWhitespace);
      if (this.reader.peek() === CHAR_PERCENT) {
        // Eat to end of line.
        this.reader.skipWhile((b) => b !== CHAR_LF && b !== CHAR_CR);
      } else {
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Names (/foo, /A#23B becomes "A#B")
  // ---------------------------------------------------------------------------

  private lexName(start: number): Token {
    this.reader.advance(1); // consume /
    let value = "";
    while (!this.reader.eof) {
      const b = this.reader.peek();
      if (b === undefined || !isRegular(b)) break;
      if (b === CHAR_HASH) {
        // Look at the next two bytes without consuming them — if either is
        // not a hex digit, leave them in place so the surrounding lexer can
        // re-emit them as their own tokens (delimiters / whitespace stay
        // intact). This keeps the broken-name error local to the name.
        const hi = this.reader.peek(1);
        const lo = this.reader.peek(2);
        if (hi === undefined || lo === undefined || !isHex(hi) || !isHex(lo)) {
          this.reader.advance(1); // consume only the # itself
          return {
            kind: "error",
            range: { start, end: this.reader.pos },
            message: "Invalid #XX escape in name",
          };
        }
        this.reader.advance(3); // # hi lo
        value += String.fromCharCode((hexValue(hi) << 4) | hexValue(lo));
        continue;
      }
      this.reader.advance(1);
      value += String.fromCharCode(b);
    }
    return { kind: "name", range: { start, end: this.reader.pos }, value };
  }

  // ---------------------------------------------------------------------------
  // Literal strings — (... with nested () and \ escapes ...)
  // ---------------------------------------------------------------------------

  private lexStringLiteral(start: number): Token {
    this.reader.advance(1); // consume (
    const out: number[] = [];
    let depth = 1;
    let terminated = false;

    while (!this.reader.eof && depth > 0) {
      const b = this.reader.read();
      if (b === undefined) break;
      if (b === CHAR_LPAREN) {
        depth++;
        out.push(b);
        continue;
      }
      if (b === CHAR_RPAREN) {
        depth--;
        if (depth === 0) {
          terminated = true;
          break;
        }
        out.push(b);
        continue;
      }
      if (b === CHAR_BACKSLASH) {
        const e = this.reader.read();
        if (e === undefined) break;
        switch (e) {
          case 0x6e:
            out.push(CHAR_LF);
            break; // \n
          case 0x72:
            out.push(CHAR_CR);
            break; // \r
          case 0x74:
            out.push(CHAR_TAB);
            break; // \t
          case 0x62:
            out.push(CHAR_BS);
            break; // \b
          case 0x66:
            out.push(CHAR_FF);
            break; // \f
          case CHAR_LPAREN:
          case CHAR_RPAREN:
          case CHAR_BACKSLASH:
            out.push(e);
            break;
          case CHAR_LF:
            break; // line continuation
          case CHAR_CR:
            if (this.reader.peek() === CHAR_LF) this.reader.advance(1);
            break;
          default: {
            if (isOctal(e)) {
              let code = e - 0x30;
              for (let i = 0; i < 2; i++) {
                const n = this.reader.peek();
                if (n === undefined || !isOctal(n)) break;
                this.reader.advance(1);
                code = (code << 3) | (n - 0x30);
              }
              out.push(code & 0xff);
            } else {
              // Unknown escape: per spec, drop the backslash, keep the char.
              out.push(e);
            }
          }
        }
        continue;
      }
      // PDF newline normalization inside literal strings: CR / CRLF → LF
      if (b === CHAR_CR) {
        if (this.reader.peek() === CHAR_LF) this.reader.advance(1);
        out.push(CHAR_LF);
        continue;
      }
      out.push(b);
    }

    if (!terminated) {
      return {
        kind: "error",
        range: { start, end: this.reader.pos },
        message: "Unterminated literal string",
      };
    }
    return {
      kind: "stringLiteral",
      range: { start, end: this.reader.pos },
      value: Uint8Array.from(out),
    };
  }

  // ---------------------------------------------------------------------------
  // Hex strings <DEADBEEF> and dictionary markers <<...>>
  // ---------------------------------------------------------------------------

  private lexLtPrefix(start: number): Token {
    if (this.reader.peek(1) === CHAR_LT) {
      this.reader.advance(2);
      return { kind: "dictStart", range: { start, end: this.reader.pos } };
    }
    this.reader.advance(1); // consume <
    return this.lexHexString(start);
  }

  private lexGtPrefix(start: number): Token {
    if (this.reader.peek(1) === CHAR_GT) {
      this.reader.advance(2);
      return { kind: "dictEnd", range: { start, end: this.reader.pos } };
    }
    this.reader.advance(1);
    return {
      kind: "error",
      range: { start, end: this.reader.pos },
      message: "Unexpected '>'",
    };
  }

  private lexHexString(start: number): Token {
    const nibbles: number[] = [];
    let terminated = false;
    let invalidCount = 0;
    while (!this.reader.eof) {
      const b = this.reader.peek();
      if (b === undefined) break;
      if (b === CHAR_GT) {
        this.reader.advance(1);
        terminated = true;
        break;
      }
      if (isWhitespace(b)) {
        this.reader.advance(1);
        continue;
      }
      if (!isHex(b)) {
        // Tolerate but track; we'll surface as error if any invalid byte appears.
        this.reader.advance(1);
        invalidCount++;
        continue;
      }
      this.reader.advance(1);
      nibbles.push(hexValue(b));
    }
    if (!terminated) {
      return {
        kind: "error",
        range: { start, end: this.reader.pos },
        message: "Unterminated hex string",
      };
    }
    if (invalidCount > 0) {
      return {
        kind: "error",
        range: { start, end: this.reader.pos },
        message: `Hex string contains ${invalidCount} invalid byte(s)`,
      };
    }
    if (nibbles.length % 2 !== 0) nibbles.push(0);
    const bytes = new Uint8Array(nibbles.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = ((nibbles[i * 2] ?? 0) << 4) | (nibbles[i * 2 + 1] ?? 0);
    }
    return { kind: "stringHex", range: { start, end: this.reader.pos }, value: bytes };
  }

  // ---------------------------------------------------------------------------
  // Numbers
  // ---------------------------------------------------------------------------

  private tryLexNumber(start: number): Token | null {
    const save = this.reader.pos;
    let sawDigit = false;
    let isReal = false;
    let i = save;
    const bytes = this.reader.bytes;
    if (bytes[i] === CHAR_PLUS || bytes[i] === CHAR_MINUS) i++;
    while (i < bytes.length) {
      const c = bytes[i] ?? -1;
      if (isDigit(c)) {
        sawDigit = true;
        i++;
      } else if (c === CHAR_DOT && !isReal) {
        isReal = true;
        i++;
      } else {
        break;
      }
    }
    if (!sawDigit) return null;
    // Must be followed by a delimiter / whitespace / EOF to be a valid number.
    const nextByte = bytes[i];
    if (nextByte !== undefined && !isWhitespace(nextByte) && !isDelimiter(nextByte)) return null;

    const slice = bytes.subarray(save, i);
    const text = asciiString(slice);
    const value = isReal ? Number.parseFloat(text) : Number.parseInt(text, 10);
    this.reader.seek(i);
    return {
      kind: isReal ? "real" : "integer",
      range: { start, end: i },
      value,
    };
  }

  // ---------------------------------------------------------------------------
  // Keywords (true, false, null, obj, endobj, R, stream, endstream, ...)
  // ---------------------------------------------------------------------------

  private lexKeywordOrError(start: number): Token {
    const begin = this.reader.pos;
    this.reader.skipWhile(isRegular);
    const end = this.reader.pos;
    if (end === begin) {
      // Couldn't make progress; consume the offending byte to avoid an
      // infinite loop and surface it as an error.
      this.reader.advance(1);
      return {
        kind: "error",
        range: { start, end: this.reader.pos },
        message: `Unexpected byte 0x${(this.reader.bytes[start] ?? 0).toString(16)}`,
      };
    }
    const word = asciiString(this.reader.subview(begin, end));
    switch (word) {
      case "true":
        return { kind: "true", range: { start, end } };
      case "false":
        return { kind: "false", range: { start, end } };
      case "null":
        return { kind: "null", range: { start, end } };
      default:
        return { kind: "keyword", range: { start, end }, value: word };
    }
  }
}

function hexValue(b: number): number {
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  if (b >= 0x41 && b <= 0x46) return b - 0x41 + 10;
  if (b >= 0x61 && b <= 0x66) return b - 0x61 + 10;
  return 0;
}

/**
 * Convenience: tokenize an entire byte range. Returns up to `eof`
 * (excluded). For very large inputs prefer instantiating Lexer
 * directly and pulling tokens lazily.
 */
export function tokenizeAll(bytes: Uint8Array, startAt = 0): Token[] {
  const reader = new ByteReader(bytes, startAt);
  const lexer = new Lexer(reader);
  const out: Token[] = [];
  // safety cap to keep test failures from looping forever
  for (let i = 0; i < bytes.length + 16; i++) {
    const t = lexer.next();
    if (t.kind === "eof") {
      out.push(t);
      return out;
    }
    out.push(t);
  }
  return out;
}
