import { describe, expect, it } from "vitest";
import { parseContentStream } from "../../../src/worker/pdf/content/parser";
import { buildVisualElements } from "../../../src/worker/pdf/content/visual-elements";
import { toBytes } from "../../../src/worker/pdf/io/byte-reader";
import type { PdfResolvedResources } from "../../../src/shared/ir-types";

function emptyResources(): PdfResolvedResources {
  return {
    pageNumber: 1,
    fonts: {},
    xobjects: {},
    extGStates: {},
    colorSpaces: {},
    patterns: {},
    shadings: {},
    properties: {},
    procSets: [],
  };
}

describe("buildVisualElements", () => {
  it("emits a text-run for Tj with a bbox derived from text matrix and CTM", () => {
    const src = "BT /F1 12 Tf 1 0 0 1 100 200 Tm (Hi) Tj ET\n";
    const { operations } = parseContentStream(toBytes(src), 1);
    const { elements } = buildVisualElements({
      pageNumber: 1,
      operations,
      resources: emptyResources(),
    });
    const text = elements.find((e) => e.kind === "text-run");
    expect(text).toBeDefined();
    expect(text!.preview).toContain("Hi");
    expect(text!.bbox.x).toBeCloseTo(100);
    expect(text!.bbox.y).toBeLessThanOrEqual(200);
  });

  it("emits an image element for Do referencing an Image XObject", () => {
    const src = "q 50 0 0 50 100 100 cm /Im1 Do Q\n";
    const { operations } = parseContentStream(toBytes(src), 1);
    const resources: PdfResolvedResources = {
      ...emptyResources(),
      xobjects: {
        Im1: {
          objectRef: "obj:99:0",
          name: "Im1",
          subtype: "Image",
          width: 100,
          height: 100,
          filters: [],
        },
      },
    };
    const { elements } = buildVisualElements({
      pageNumber: 1,
      operations,
      resources,
    });
    const image = elements.find((e) => e.kind === "image");
    expect(image).toBeDefined();
    // 50x50 scaled, translated to (100, 100).
    expect(image!.bbox.x).toBeCloseTo(100);
    expect(image!.bbox.y).toBeCloseTo(100);
    expect(image!.bbox.w).toBeCloseTo(50);
    expect(image!.bbox.h).toBeCloseTo(50);
  });

  it("emits warnings when Do references missing XObjects", () => {
    const src = "/Missing Do\n";
    const { operations } = parseContentStream(toBytes(src), 1);
    const { warnings } = buildVisualElements({
      pageNumber: 1,
      operations,
      resources: emptyResources(),
    });
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("emits one element per Tj/TJ string with source operation ids", () => {
    const src = "BT /F1 10 Tf (A) Tj (B) Tj ET\n";
    const { operations } = parseContentStream(toBytes(src), 1);
    const { elements } = buildVisualElements({
      pageNumber: 1,
      operations,
      resources: emptyResources(),
    });
    const text = elements.filter((e) => e.kind === "text-run");
    expect(text).toHaveLength(2);
    expect(text[0]?.sourceOperationIds.length).toBe(1);
  });
});
