/**
 * Cross-reference stream parser (ISO 32000-2 §7.5.8).
 *
 * Reads the indirect object at `offset`, validates it is a /Type /XRef
 * stream, decodes the stream, and projects the binary entries through
 * the /W field-width array into PdfXrefEntry records.
 */

import type {
  PdfFilter,
  PdfTrailer,
  PdfValue,
  PdfWarning,
  PdfXref,
  PdfXrefEntry,
} from "../../../shared/ir-types";
import { objectId } from "../../../shared/ir-types";
import type { ByteReader } from "../io/byte-reader";
import { IndirectObjectReader } from "../parse/object-reader";
import { dictGet, expectArray, expectInt, extractFilters } from "../parse/value-parser";
import { decodeStream, extractDecodeParms, UnsupportedFilterError } from "../streams/decode";

export interface XrefStreamResult {
  xref: PdfXref;
  trailer: PdfTrailer;
  warnings: PdfWarning[];
}

export async function parseXrefStream(
  reader: ByteReader,
  offset: number,
): Promise<XrefStreamResult> {
  const objReader = new IndirectObjectReader(reader);
  const obj = objReader.readAt(offset);
  if (obj.value.kind !== "stream") {
    throw new Error(`Object at ${offset} is not a stream (got ${obj.value.kind})`);
  }
  const dict = obj.value.dict;
  const filters: PdfFilter[] = extractFilters(dict);
  const parms = extractDecodeParms(dict);

  const warnings: PdfWarning[] = [];

  if (!obj.streamRange) {
    throw new Error(`xref stream object ${obj.id} has no stream range`);
  }
  const raw = reader.subview(obj.streamRange.start, obj.streamRange.end);

  let decoded: Uint8Array;
  try {
    decoded = await decodeStream(raw, filters, parms);
  } catch (err) {
    if (err instanceof UnsupportedFilterError) {
      throw new Error(`xref stream uses unsupported filter ${err.filter}`);
    }
    throw err;
  }

  const widths = expectArray(dict.W);
  if (!widths || widths.length < 3) {
    throw new Error("xref stream is missing /W");
  }
  const wType = expectInt(widths[0]) ?? 0;
  const wField2 = expectInt(widths[1]) ?? 0;
  const wField3 = expectInt(widths[2]) ?? 0;
  const entryWidth = wType + wField2 + wField3;
  if (entryWidth <= 0) {
    throw new Error(`xref stream /W ${JSON.stringify([wType, wField2, wField3])} is invalid`);
  }

  const size = expectInt(dict.Size);
  const indexRaw = expectArray(dict.Index);
  const ranges = buildIndexRanges(indexRaw, size);

  const entries: PdfXrefEntry[] = [];
  let cursor = 0;
  for (const [firstObj, count] of ranges) {
    for (let i = 0; i < count; i++) {
      if (cursor + entryWidth > decoded.length) {
        warnings.push({
          id: `warn:xrefstream-truncated:${offset}-${cursor}`,
          severity: "warn",
          category: "xref",
          message: "Truncated xref stream entry",
        });
        break;
      }
      const type =
        wType === 0
          ? 1 // default per spec when omitted
          : readBE(decoded, cursor, wType);
      const f2 = readBE(decoded, cursor + wType, wField2);
      const f3 = readBE(decoded, cursor + wType + wField2, wField3);
      const objectNumber = firstObj + i;
      entries.push(mapEntry(type, f2, f3, objectNumber));
      cursor += entryWidth;
    }
  }

  const trailer: PdfTrailer = {
    range: obj.range,
    dict,
  };
  const xref: PdfXref = {
    kind: "stream",
    range: obj.range,
    objectRef: obj.id,
    entries,
  };
  return { xref, trailer, warnings };
}

function mapEntry(type: number, f2: number, f3: number, objectNumber: number): PdfXrefEntry {
  if (type === 0) {
    return { objectNumber, generation: f3, type: "f", offset: f2 };
  }
  if (type === 1) {
    return { objectNumber, generation: f3, type: "n", offset: f2 };
  }
  if (type === 2) {
    return {
      objectNumber,
      generation: 0,
      type: "compressed",
      compressedIn: objectId(f2, 0),
      indexInStream: f3,
    };
  }
  // Unknown — treat as free per spec advice.
  return { objectNumber, generation: 65535, type: "f" };
}

function buildIndexRanges(
  indexRaw: PdfValue[] | undefined,
  size: number | undefined,
): [number, number][] {
  if (!indexRaw || indexRaw.length === 0) {
    return [[0, size ?? 0]];
  }
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < indexRaw.length; i += 2) {
    const first = expectInt(indexRaw[i]) ?? 0;
    const count = expectInt(indexRaw[i + 1]) ?? 0;
    out.push([first, count]);
  }
  return out;
}

function readBE(buf: Uint8Array, offset: number, width: number): number {
  let acc = 0;
  for (let i = 0; i < width; i++) acc = (acc << 8) | (buf[offset + i] ?? 0);
  return acc >>> 0;
}

// re-export helpers for callers that resolve /Prev chains
export { dictGet, expectInt };
