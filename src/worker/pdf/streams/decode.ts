/**
 * Stream filter pipeline.
 *
 * Currently knows FlateDecode (the most common filter); other filters
 * raise an UnsupportedFilterError so callers can surface a warning
 * instead of guessing. Additional decoders land in their own files
 * and register here.
 */

import { flateDecode } from "./flate";
import type { PdfDict, PdfFilter, PdfValue } from "../../../shared/ir-types";

export class UnsupportedFilterError extends Error {
  constructor(public filter: PdfFilter) {
    const name = typeof filter === "string" ? filter : filter.name;
    super(`Unsupported PDF filter: ${name}`);
    this.name = "UnsupportedFilterError";
  }
}

/**
 * Pull /DecodeParms out of a stream dict into a parallel array
 * aligned with the filters list. The dict entry can be either a
 * single dict (one filter case) or an array of dicts.
 */
export function extractDecodeParms(streamDict: PdfDict): (PdfDict | undefined)[] {
  const entry = streamDict.DecodeParms ?? streamDict.DP;
  if (!entry) return [];
  if (entry.kind === "dict") return [entry.entries];
  if (entry.kind === "array") {
    return entry.items.map((item): PdfDict | undefined => {
      if (item.kind === "dict") return item.entries;
      return undefined;
    });
  }
  return [];
}

export async function decodeStream(
  raw: Uint8Array,
  filters: PdfFilter[],
  parmsList: (PdfDict | undefined)[] = [],
): Promise<Uint8Array> {
  let current = raw;
  for (let i = 0; i < filters.length; i++) {
    const filter = filters[i]!;
    const parms = parmsList[i];
    if (filter === "FlateDecode") {
      current = await flateDecode(current, parms);
      continue;
    }
    if (filter === "ASCIIHexDecode") {
      current = asciiHexDecode(current);
      continue;
    }
    if (filter === "ASCII85Decode") {
      current = ascii85Decode(current);
      continue;
    }
    throw new UnsupportedFilterError(filter);
  }
  return current;
}

// ---- Cheap text filters needed even on first contact ----

function asciiHexDecode(input: Uint8Array): Uint8Array {
  const nibbles: number[] = [];
  for (const b of input) {
    if (b === 0x3e) break; // '>' terminator
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) continue;
    const n = hexNibble(b);
    if (n === -1) continue;
    nibbles.push(n);
  }
  if (nibbles.length % 2 !== 0) nibbles.push(0);
  const out = new Uint8Array(nibbles.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = ((nibbles[i * 2] ?? 0) << 4) | (nibbles[i * 2 + 1] ?? 0);
  }
  return out;
}

function ascii85Decode(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let group: number[] = [];
  for (const b of input) {
    if (b === 0x7e) break; // '~' which starts the '~>' terminator
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) continue;
    if (b === 0x7a) {
      // 'z' shorthand for four zero bytes.
      out.push(0, 0, 0, 0);
      group = [];
      continue;
    }
    if (b < 0x21 || b > 0x75) continue; // out of '!'..'u'
    group.push(b - 0x21);
    if (group.length === 5) {
      out.push(...packGroup(group, 4));
      group = [];
    }
  }
  if (group.length > 0) {
    while (group.length < 5) group.push(0);
    out.push(...packGroup(group, group.length - 1));
  }
  return Uint8Array.from(out);
}

function packGroup(group: number[], take: number): number[] {
  let acc = 0;
  for (let i = 0; i < 5; i++) acc = acc * 85 + (group[i] ?? 0);
  const bytes = [(acc >>> 24) & 0xff, (acc >>> 16) & 0xff, (acc >>> 8) & 0xff, acc & 0xff];
  return bytes.slice(0, take);
}

function hexNibble(b: number): number {
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  if (b >= 0x41 && b <= 0x46) return b - 0x41 + 10;
  if (b >= 0x61 && b <= 0x66) return b - 0x61 + 10;
  return -1;
}

/** Helper: read /Length from a stream dict to allocate the right buffer. */
export function readStreamLength(dict: PdfDict): number | undefined {
  const len = dict.Length;
  if (!len) return undefined;
  if (len.kind === "int") return len.value;
  if (len.kind === "real") return Math.trunc(len.value);
  return undefined;
}

export type { PdfValue };
