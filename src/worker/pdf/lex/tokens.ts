/**
 * Token shapes produced by the lexer.
 *
 * Every token carries the absolute byte range it occupies in the
 * source file (`ByteRange`) so downstream consumers can highlight or
 * jump back to the raw bytes.
 */

import type { ByteRange } from "../../../shared/ir-types";

export type Token =
  | { kind: "comment"; range: ByteRange; text: string }
  | { kind: "name"; range: ByteRange; value: string }
  | { kind: "stringLiteral"; range: ByteRange; value: Uint8Array }
  | { kind: "stringHex"; range: ByteRange; value: Uint8Array }
  | { kind: "integer"; range: ByteRange; value: number }
  | { kind: "real"; range: ByteRange; value: number }
  | { kind: "true"; range: ByteRange }
  | { kind: "false"; range: ByteRange }
  | { kind: "null"; range: ByteRange }
  | { kind: "dictStart"; range: ByteRange }
  | { kind: "dictEnd"; range: ByteRange }
  | { kind: "arrayStart"; range: ByteRange }
  | { kind: "arrayEnd"; range: ByteRange }
  | { kind: "keyword"; range: ByteRange; value: string }
  | { kind: "eof"; range: ByteRange }
  | { kind: "error"; range: ByteRange; message: string };
