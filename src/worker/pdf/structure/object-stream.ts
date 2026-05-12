/**
 * Object stream parser (ISO 32000-2 §7.5.7).
 *
 * An object stream is an indirect object of /Type /ObjStm whose
 * decoded body packs the bodies of N other objects. The header
 * lists N pairs of (objectNumber, offsetFromFirst). The /First
 * dict entry gives the byte offset within the decoded stream
 * where the object bodies begin.
 */

import type { ObjectId, PdfValue } from "../../../shared/ir-types";
import { objectId } from "../../../shared/ir-types";
import { ByteReader } from "../io/byte-reader";
import { Lexer } from "../lex/lexer";
import { TokenStream } from "../lex/token-stream";
import type { IndirectObject } from "../parse/object-reader";
import { ValueParser, expectInt, extractFilters } from "../parse/value-parser";
import { decodeStream, extractDecodeParms } from "../streams/decode";

export interface ObjectStreamEntry {
  id: ObjectId;
  number: number;
  bodyOffset: number;
  value: PdfValue;
}

export interface ObjectStreamContents {
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
  const n = expectInt(dict.N) ?? 0;
  const first = expectInt(dict.First) ?? 0;
  const raw = reader.slice(obj.streamRange.start, obj.streamRange.end);
  const decoded = await decodeStream(raw, extractFilters(dict), extractDecodeParms(dict));

  // Header: N pairs of (objNum, offsetFromFirst)
  const headerLexer = new Lexer(new ByteReader(decoded));
  const tokens = new TokenStream(headerLexer);
  const pairs: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const num = tokens.consume();
    const off = tokens.consume();
    if (num.kind !== "integer" || off.kind !== "integer") {
      throw new Error(`Malformed ObjStm header at pair ${i}`);
    }
    pairs.push([num.value, off.value]);
  }

  const entries: ObjectStreamEntry[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const [num, relOff] = pairs[i]!;
    const start = first + relOff;
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
