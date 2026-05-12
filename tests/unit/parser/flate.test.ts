import { describe, expect, it } from "vitest";
import {
  flateDecode,
  inflateZlib,
  pngPredictor,
  tiffPredictorRowMajor,
} from "../../../src/worker/pdf/streams/flate";

async function deflate(input: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(input);
      controller.close();
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const encoded = source.pipeThrough(new CompressionStream("deflate") as any);
  const buf = await new Response(encoded).arrayBuffer();
  return new Uint8Array(buf);
}

async function deflateRaw(input: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(input);
      controller.close();
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const encoded = source.pipeThrough(new CompressionStream("deflate-raw") as any);
  const buf = await new Response(encoded).arrayBuffer();
  return new Uint8Array(buf);
}

describe("inflateZlib", () => {
  it("round-trips zlib-encoded data", async () => {
    const original = new TextEncoder().encode("Hello, PDF DevTools!");
    const compressed = await deflate(original);
    const decompressed = await inflateZlib(compressed);
    expect(Array.from(decompressed)).toEqual(Array.from(original));
  });

  it("rejects non-zlib data", async () => {
    const raw = new Uint8Array([1, 2, 3, 4]);
    await expect(inflateZlib(raw)).rejects.toThrow();
  });

  it("does not accept deflate-raw (PDF mandates zlib wrapped)", async () => {
    const original = new TextEncoder().encode("plain");
    const raw = await deflateRaw(original);
    await expect(inflateZlib(raw)).rejects.toThrow();
  });
});

describe("pngPredictor", () => {
  it("reverses filter type 2 (Up)", () => {
    // 2 rows, 4 columns, 1 color, 8 bpc → bytesPerRow = 4, stride = 5
    const input = new Uint8Array([
      0, 10, 20, 30, 40, // row 0 filter=None
      2, 1, 2, 3, 4,     // row 1 filter=Up adds previous row
    ]);
    const out = pngPredictor(input, {
      predictor: 12,
      colors: 1,
      bitsPerComponent: 8,
      columns: 4,
    });
    expect(Array.from(out)).toEqual([10, 20, 30, 40, 11, 22, 33, 44]);
  });

  it("handles filter 0 (None) as identity", () => {
    const input = new Uint8Array([0, 1, 2, 3, 4]);
    const out = pngPredictor(input, {
      predictor: 12,
      colors: 1,
      bitsPerComponent: 8,
      columns: 4,
    });
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
  });
});

describe("tiffPredictorRowMajor", () => {
  it("reverses additive differences (predictor 2)", () => {
    const input = new Uint8Array([1, 1, 1, 1]); // 1 row, 4 columns, 1 color
    const out = tiffPredictorRowMajor(input, {
      predictor: 2,
      colors: 1,
      bitsPerComponent: 8,
      columns: 4,
    });
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
  });
});

describe("flateDecode (integration)", () => {
  it("inflates and applies PNG predictor end-to-end", async () => {
    const rows = new Uint8Array([
      0, 10, 20, 30, 40,
      2, 1, 2, 3, 4,
    ]);
    const compressed = await deflate(rows);
    const out = await flateDecode(compressed, {
      Predictor: { kind: "int", value: 12 },
      Columns: { kind: "int", value: 4 },
      Colors: { kind: "int", value: 1 },
      BitsPerComponent: { kind: "int", value: 8 },
    });
    expect(Array.from(out)).toEqual([10, 20, 30, 40, 11, 22, 33, 44]);
  });
});
