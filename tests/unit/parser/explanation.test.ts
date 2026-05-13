import { describe, expect, it } from "vitest";
import { explainOperator } from "../../../src/shared/pdf-spec";
import type { PdfOperation } from "../../../src/shared/ir-types";

function op(operator: string, operands: PdfOperation["operands"] = []): PdfOperation {
  return {
    id: "page:1:op:0",
    sequence: 0,
    operator,
    operands,
    category: "unknown",
  };
}

describe("explainOperator", () => {
  it("explains graphics state operators", () => {
    expect(explainOperator(op("q")).technical).toMatch(/Save graphics state/);
    expect(explainOperator(op("Q")).technical).toMatch(/Restore graphics state/);
  });

  it("interpolates operand values into the human summary", () => {
    const ex = explainOperator(op("w", [{ kind: "real", value: 2.5 }]));
    expect(ex.human).toContain("2.5");
    expect(ex.technical).toMatch(/line width/i);
  });

  it("Tf includes both font name and size", () => {
    const ex = explainOperator(
      op("Tf", [
        { kind: "name", value: "F1" },
        { kind: "int", value: 12 },
      ]),
    );
    expect(ex.human).toContain("/F1");
    expect(ex.human).toContain("12");
  });

  it("Tj summarises the displayed string", () => {
    const ex = explainOperator(op("Tj", [{ kind: "string", raw: new Uint8Array([0x48, 0x69]) }]));
    expect(ex.human).toContain("Hi");
  });

  it("provides a fallback for unknown operators", () => {
    const ex = explainOperator(op("Zz"));
    expect(ex.human).toMatch(/まだ用意されていません|not yet documented/);
  });
});
