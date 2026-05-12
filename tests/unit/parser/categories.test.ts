import { describe, expect, it } from "vitest";
import { categorizeOperator, OPERATOR_CATEGORY } from "../../../src/worker/pdf/content/categories";
import { parseContentStream } from "../../../src/worker/pdf/content/parser";
import { toBytes } from "../../../src/worker/pdf/io/byte-reader";

describe("categorizeOperator", () => {
  it("labels graphics-state operators", () => {
    expect(categorizeOperator("q")).toBe("graphics-state");
    expect(categorizeOperator("Q")).toBe("graphics-state");
    expect(categorizeOperator("cm")).toBe("graphics-state");
    expect(categorizeOperator("gs")).toBe("graphics-state");
  });

  it("labels text operators across sub-categories", () => {
    expect(categorizeOperator("BT")).toBe("text-object");
    expect(categorizeOperator("Tf")).toBe("text-state");
    expect(categorizeOperator("Td")).toBe("text-positioning");
    expect(categorizeOperator("Tj")).toBe("text-show");
  });

  it("labels color, xobject, shading, marked content, image-inline", () => {
    expect(categorizeOperator("rg")).toBe("color");
    expect(categorizeOperator("Do")).toBe("xobject");
    expect(categorizeOperator("sh")).toBe("shading");
    expect(categorizeOperator("BDC")).toBe("marked-content");
    expect(categorizeOperator("BI/EI")).toBe("image-inline");
  });

  it("returns unknown for unrecognized operators", () => {
    expect(categorizeOperator("Xy")).toBe("unknown");
  });

  it("covers every operator the parser produces in a typical stream", () => {
    const src = "q\n2 w\nBT\n/F1 12 Tf\n(Hello) Tj\nET\nQ\n";
    const { operations } = parseContentStream(toBytes(src), 1);
    for (const op of operations) {
      expect(op.category).not.toBe("unknown");
    }
  });

  it("operator table includes the canonical set", () => {
    // Sanity: at least 50 operators are recognized.
    expect(OPERATOR_CATEGORY.size).toBeGreaterThanOrEqual(50);
  });
});
