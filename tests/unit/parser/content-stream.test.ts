import { describe, expect, it } from "vitest";
import { parseContentStream } from "../../../src/worker/pdf/content/parser";
import { toBytes } from "../../../src/worker/pdf/io/byte-reader";

describe("parseContentStream", () => {
  it("returns operator-first events in order", () => {
    const src = "q\n2 w\nBT\n/F1 12 Tf\n(Hello) Tj\nET\nQ\n";
    const { operations } = parseContentStream(toBytes(src), 1);
    expect(operations.map((o) => o.operator)).toEqual(["q", "w", "BT", "Tf", "Tj", "ET", "Q"]);
    expect(operations[1]?.operands[0]).toMatchObject({ kind: "int", value: 2 });
    const tf = operations[3]!;
    expect(tf.operands[0]).toMatchObject({ kind: "name", value: "F1" });
    expect(tf.operands[1]).toMatchObject({ kind: "int", value: 12 });
  });

  it("captures byte ranges for each operation", () => {
    const { operations } = parseContentStream(toBytes("q 1 w Q"), 7);
    for (const op of operations) {
      expect(op.decodedRange).toBeDefined();
      expect(op.decodedRange!.start).toBeLessThan(op.decodedRange!.end);
    }
    expect(operations[0]?.id).toBe("page:7:op:0");
  });

  it("handles TJ arrays as a single array operand", () => {
    const src = `[(Hello) -2 ( ) -3 (World)] TJ\n`;
    const { operations } = parseContentStream(toBytes(src), 1);
    expect(operations[0]?.operator).toBe("TJ");
    expect(operations[0]?.operands[0]?.kind).toBe("array");
  });

  it("folds BI…ID…EI into a single inline-image operation", () => {
    const src = "q\nBI /W 2 /H 2 /BPC 8 ID \x00\x01\x02\x03\nEI\nQ\n";
    const { operations } = parseContentStream(toBytes(src), 2);
    const operators = operations.map((o) => o.operator);
    expect(operators).toContain("BI/EI");
    expect(operators[0]).toBe("q");
    expect(operators[operators.length - 1]).toBe("Q");
  });

  it("emits a warning when content is malformed but keeps parsing", () => {
    // Inject an unterminated dict — the parser should warn and continue.
    const src = "q\n<< /Foo\n";
    const { warnings } = parseContentStream(toBytes(src), 1);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
