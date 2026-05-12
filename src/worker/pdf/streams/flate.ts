/**
 * FlateDecode (ISO 32000-2 §7.4.4) using the browser-native
 * DecompressionStream so we ship zero zlib bytes ourselves.
 *
 * Also implements the optional PNG predictor reconstruction
 * (Predictor 10..15 per ISO 32000-2 Table 8). PDF readers almost
 * universally combine these two when /DecodeParms is set.
 *
 * Most callers should use `flateDecode(input, parms)` which composes
 * both steps. The helpers are exposed for testing and reuse.
 */

import type { PdfDict, PdfValue } from "../../../shared/ir-types";

export async function inflateZlib(input: Uint8Array): Promise<Uint8Array> {
  // DecompressionStream is available in modern browsers and Node 21+.
  // We avoid `Blob.stream()` so this also works under jsdom in tests.
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(input);
      controller.close();
    },
  });
  // The lib.dom typing for DecompressionStream uses BufferSource for writable,
  // which fails the invariance check against ReadableStream<Uint8Array>.
  // The runtime types are compatible; cast through unknown to silence TS.
  const decoded = source.pipeThrough(
    new DecompressionStream("deflate") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
  );
  const buf = await new Response(decoded).arrayBuffer();
  return new Uint8Array(buf);
}

export interface FlateDecodeParms {
  predictor: number;
  colors: number;
  bitsPerComponent: number;
  columns: number;
}

export function readFlateParms(parms: PdfDict | undefined): FlateDecodeParms {
  return {
    predictor: readInt(parms?.Predictor, 1),
    colors: readInt(parms?.Colors, 1),
    bitsPerComponent: readInt(parms?.BitsPerComponent, 8),
    columns: readInt(parms?.Columns, 1),
  };
}

function readInt(value: PdfValue | undefined, fallback: number): number {
  if (!value) return fallback;
  if (value.kind === "int") return value.value;
  if (value.kind === "real") return Math.trunc(value.value);
  return fallback;
}

export async function flateDecode(
  input: Uint8Array,
  parmsDict?: PdfDict,
): Promise<Uint8Array> {
  const decompressed = await inflateZlib(input);
  const parms = readFlateParms(parmsDict);
  if (parms.predictor <= 1) return decompressed;
  if (parms.predictor === 2) return tiffPredictorRowMajor(decompressed, parms);
  if (parms.predictor >= 10) return pngPredictor(decompressed, parms);
  return decompressed;
}

// =============================================================================
// PNG predictor (Predictor 10..15 in PDF, PNG filter types 0..4)
// =============================================================================

export function pngPredictor(input: Uint8Array, parms: FlateDecodeParms): Uint8Array {
  const colors = Math.max(1, parms.colors);
  const bpc = parms.bitsPerComponent <= 0 ? 8 : parms.bitsPerComponent;
  const columns = Math.max(1, parms.columns);
  const bytesPerPixel = Math.max(1, Math.ceil((colors * bpc) / 8));
  const bytesPerRow = Math.ceil((colors * bpc * columns) / 8);
  const stride = bytesPerRow + 1; // first byte of each row is the filter type
  const rows = Math.floor(input.length / stride);
  const out = new Uint8Array(rows * bytesPerRow);

  let prevRow = new Uint8Array(bytesPerRow);

  for (let r = 0; r < rows; r++) {
    const rowStart = r * stride;
    const filterType = input[rowStart] ?? 0;
    const row = new Uint8Array(bytesPerRow);
    for (let i = 0; i < bytesPerRow; i++) {
      const x = input[rowStart + 1 + i] ?? 0;
      const left = i >= bytesPerPixel ? (row[i - bytesPerPixel] ?? 0) : 0;
      const up = prevRow[i] ?? 0;
      const upLeft = i >= bytesPerPixel ? (prevRow[i - bytesPerPixel] ?? 0) : 0;
      switch (filterType) {
        case 0: // None
          row[i] = x;
          break;
        case 1: // Sub
          row[i] = (x + left) & 0xff;
          break;
        case 2: // Up
          row[i] = (x + up) & 0xff;
          break;
        case 3: // Average
          row[i] = (x + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4: // Paeth
          row[i] = (x + paeth(left, up, upLeft)) & 0xff;
          break;
        default:
          row[i] = x;
      }
    }
    out.set(row, r * bytesPerRow);
    prevRow = row;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// =============================================================================
// TIFF predictor 2 (component-wise additive)
// =============================================================================

export function tiffPredictorRowMajor(input: Uint8Array, parms: FlateDecodeParms): Uint8Array {
  const colors = Math.max(1, parms.colors);
  const bpc = parms.bitsPerComponent <= 0 ? 8 : parms.bitsPerComponent;
  if (bpc !== 8) {
    // Multi-bit TIFF predictor variants are rare in PDF — emit unchanged.
    return input;
  }
  const columns = Math.max(1, parms.columns);
  const bytesPerRow = colors * columns;
  const out = new Uint8Array(input.length);
  for (let r = 0; r * bytesPerRow < input.length; r++) {
    const off = r * bytesPerRow;
    const last = new Uint8Array(colors);
    for (let i = 0; i < bytesPerRow; i++) {
      const c = i % colors;
      const v = ((input[off + i] ?? 0) + (last[c] ?? 0)) & 0xff;
      out[off + i] = v;
      last[c] = v;
    }
  }
  return out;
}
