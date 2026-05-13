/**
 * ByteReader — keeps every read paired with a byte offset.
 *
 * Operates on a Uint8Array view (no copies). All scanning utilities
 * preserve the invariant that `pos` always points to the next unread
 * byte and that no operation reads past `end`.
 */

export class ByteReader {
  readonly bytes: Uint8Array;
  private cursor: number;

  constructor(bytes: Uint8Array, startAt = 0) {
    this.bytes = bytes;
    this.cursor = startAt;
  }

  get pos(): number {
    return this.cursor;
  }

  get end(): number {
    return this.bytes.length;
  }

  get eof(): boolean {
    return this.cursor >= this.bytes.length;
  }

  seek(pos: number): void {
    if (pos < 0 || pos > this.bytes.length) {
      throw new RangeError(`seek out of bounds: ${pos}`);
    }
    this.cursor = pos;
  }

  advance(n: number): void {
    this.seek(this.cursor + n);
  }

  peek(offset = 0): number | undefined {
    return this.bytes[this.cursor + offset];
  }

  /**
   * Read and consume one byte, or return `undefined` at EOF.
   * The EOF signal is the same as `peek()` — both return `undefined`,
   * not the `-1` sentinel that some C-flavoured APIs use.
   */
  read(): number | undefined {
    if (this.eof) return undefined;
    return this.bytes[this.cursor++];
  }

  /**
   * Return a zero-copy view over `[start, end)`. Mutations to the
   * returned Uint8Array will write through to the underlying buffer —
   * if you need to own the bytes, call `.slice()` on the result.
   */
  subview(start: number, end: number): Uint8Array {
    return this.bytes.subarray(start, end);
  }

  /** Consume n bytes and return a subview. Throws on out-of-range. */
  consume(n: number): Uint8Array {
    if (this.cursor + n > this.bytes.length) {
      throw new RangeError(`consume past end: pos=${this.cursor} n=${n}`);
    }
    const out = this.bytes.subarray(this.cursor, this.cursor + n);
    this.cursor += n;
    return out;
  }

  /** Advance while predicate(byte) is true. Returns the number of bytes skipped. */
  skipWhile(pred: (byte: number) => boolean): number {
    const start = this.cursor;
    while (!this.eof) {
      const b = this.bytes[this.cursor];
      if (b === undefined || !pred(b)) break;
      this.cursor++;
    }
    return this.cursor - start;
  }

  /** Returns true and advances if the byte sequence is present at the current position. */
  consumeIf(seq: Uint8Array | string): boolean {
    const target = typeof seq === "string" ? toBytes(seq) : seq;
    if (this.cursor + target.length > this.bytes.length) return false;
    for (let i = 0; i < target.length; i++) {
      if (this.bytes[this.cursor + i] !== target[i]) return false;
    }
    this.cursor += target.length;
    return true;
  }

  /** Like consumeIf, but only checks without advancing. */
  startsWith(seq: Uint8Array | string, atOffset = 0): boolean {
    const target = typeof seq === "string" ? toBytes(seq) : seq;
    if (this.cursor + atOffset + target.length > this.bytes.length) return false;
    for (let i = 0; i < target.length; i++) {
      if (this.bytes[this.cursor + atOffset + i] !== target[i]) return false;
    }
    return true;
  }

  /**
   * Find the next occurrence of `seq` in `[searchStart, searchEnd)`.
   * Returns -1 if absent. Does not move the cursor.
   */
  indexOf(seq: Uint8Array | string, searchStart = this.cursor, searchEnd = this.bytes.length): number {
    const target = typeof seq === "string" ? toBytes(seq) : seq;
    if (target.length === 0) return searchStart;
    const last = Math.min(searchEnd, this.bytes.length) - target.length;
    outer: for (let i = searchStart; i <= last; i++) {
      for (let j = 0; j < target.length; j++) {
        if (this.bytes[i + j] !== target[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  /** Search backwards. Used for locating `startxref` near EOF. */
  lastIndexOf(seq: Uint8Array | string, searchEnd = this.bytes.length): number {
    const target = typeof seq === "string" ? toBytes(seq) : seq;
    if (target.length === 0) return Math.max(0, searchEnd);
    const max = Math.min(searchEnd, this.bytes.length) - target.length;
    outer: for (let i = max; i >= 0; i--) {
      for (let j = 0; j < target.length; j++) {
        if (this.bytes[i + j] !== target[j]) continue outer;
      }
      return i;
    }
    return -1;
  }
}

// ---- Byte / character classification (ISO 32000-2 §7.2.3 / §7.5.x) ----

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const EOL = new Set([0x0a, 0x0d]);
const DELIMITERS = new Set([
  0x28,
  0x29, // ( )
  0x3c,
  0x3e, // < >
  0x5b,
  0x5d, // [ ]
  0x7b,
  0x7d, // { }
  0x2f, // /
  0x25, // %
]);

export function isWhitespace(b: number): boolean {
  return WHITESPACE.has(b);
}

export function isEol(b: number): boolean {
  return EOL.has(b);
}

export function isDelimiter(b: number): boolean {
  return DELIMITERS.has(b);
}

export function isRegular(b: number): boolean {
  return !WHITESPACE.has(b) && !DELIMITERS.has(b);
}

export function isDigit(b: number): boolean {
  return b >= 0x30 && b <= 0x39;
}

export function isOctal(b: number): boolean {
  return b >= 0x30 && b <= 0x37;
}

export function isHex(b: number): boolean {
  return (
    (b >= 0x30 && b <= 0x39) ||
    (b >= 0x41 && b <= 0x46) ||
    (b >= 0x61 && b <= 0x66)
  );
}

// ---- Encoding helpers ----

export function toBytes(input: string): Uint8Array {
  // Latin-1 / one-byte-per-codepoint encoding. PDF lexical syntax is ASCII.
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input.charCodeAt(i) & 0xff;
  return out;
}

export function asciiString(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}
