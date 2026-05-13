/**
 * Object stream parser (ISO 32000-2 §7.5.7).
 *
 * An object stream is an indirect object of /Type /ObjStm whose
 * decoded body packs the bodies of N other objects. The header
 * lists N pairs of (objectNumber, offsetFromFirst). The /First
 * dict entry gives the byte offset within the decoded stream
 * where the object bodies begin.
 */

import { objectId } from "../../../shared/ir-types";
import { ByteReader } from "../io/byte-reader";
import { Lexer } from "../lex/lexer";
import { TokenStream } from "../lex/token-stream";
import { ValueParser, expectInt, expectName, extractFilters } from "../parse/value-parser";
import { decodeStream, extractDecodeParms } from "../streams/decode";
import type { IndirectObject } from "../parse/object-reader";
import type { ObjectId, PdfValue } from "../../../shared/ir-types";

export type ObjectStreamEntry = {
  id: ObjectId;
  number: number;
  bodyOffset: number;
  value: PdfValue;
}

export type ObjectStreamContents = {
  parent: ObjectId;
  entries: ObjectStreamEntry[];
  decoded: Uint8Array;
}

export async function parseObjectStream(
  reader: ByteReader,
  obj: IndirectObject,
): Promise<ObjectStreamContents> {
  if (obj.value.kind !== "stream") {
    throw new Error(`Object ${obj.id} is not a stream`);
  }
  if (!obj.streamRange) {
    throw new Error(`Object ${obj.id} stream has no range`);
  }
  const dict = obj.value.dict;
  // Guard against being handed something that isn't /Type /ObjStm. The xref
  // table can name any object as "compressedIn"; if a malformed xref points
  // at a non-ObjStm we want a clean rejection, not silently corrupted IR.
  const typeName = expectName(dict.Type);
  if (typeName !== "ObjStm") {
    throw new Error(`Object ${obj.id} claimed as ObjStm but /Type is ${typeName ?? "(missing)"}`);
  }
  const n = expectInt(dict.N);
  const first = expectInt(dict.First);
  if (n == null || n < 0 || first == null || first < 0) {
    throw new Error(`Object ${obj.id} ObjStm missing /N or /First`);
  }
  const raw = reader.subview(obj.streamRange.start, obj.streamRange.end);
  const decoded = await decodeStream(raw, extractFilters(dict), extractDecodeParms(dict));
  if (first > decoded.length) {
    throw new Error(`Object ${obj.id} ObjStm /First out of range`);
  }

  // Header: N pairs of (objNum, offsetFromFirst)
  const headerLexer = new Lexer(new ByteReader(decoded));
  const tokens = new TokenStream(headerLexer);
  const pairs: [number, number][] = [];
  let lastOffset = -1;
  for (let i = 0; i < n; i++) {
    const num = tokens.consume();
    const off = tokens.consume();
    if (num.kind !== "integer" || off.kind !== "integer") {
      throw new Error(`Malformed ObjStm header at pair ${i}`);
    }
    if (num.value < 0 || off.value < 0 || off.value <= lastOffset) {
      throw new Error(`ObjStm header pair ${i} is not monotonic`);
    }
    lastOffset = off.value;
    pairs.push([num.value, off.value]);
  }

  const entries: ObjectStreamEntry[] = [];
  for (const [num, relOff] of pairs) {
    const start = first + relOff;
    if (start > decoded.length) {
      throw new Error(`ObjStm body offset ${start} exceeds decoded length`);
    }
    const valueLexer = new Lexer(new ByteReader(decoded, start));
    const valueTokens = new TokenStream(valueLexer);
    const value = new ValueParser(valueTokens).parseValue();
    entries.push({
      id: objectId(num, 0),
      number: num,
      bodyOffset: start,
      value,
    });
  }

  return {
    parent: obj.id,
    entries,
    decoded,
  };
}
