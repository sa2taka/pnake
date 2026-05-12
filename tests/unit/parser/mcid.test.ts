import { describe, expect, it } from "vitest";
import { parseContentStream } from "../../../src/worker/pdf/content/parser";
import { toBytes } from "../../../src/worker/pdf/io/byte-reader";

describe("MCID propagation through BDC/EMC", () => {
  it("attaches /MCID from BDC to enclosed operations", () => {
    const src = `/Span << /MCID 5 >> BDC
BT
/F1 12 Tf
(Hello) Tj
ET
EMC
q
1 w
Q
`;
    const { operations } = parseContentStream(toBytes(src), 1);
    const inside = operations.filter((o) => o.mcid === 5);
    expect(inside.length).toBeGreaterThan(0);
    expect(inside.map((o) => o.operator)).toContain("Tj");

    const outsideOps = operations.filter((o) => o.operator === "w");
    expect(outsideOps[0]?.mcid).toBeUndefined();
  });

  it("supports nested BDC where the innermost MCID wins", () => {
    const src = `/Span << /MCID 1 >> BDC
/Span << /MCID 2 >> BDC
(Inner) Tj
EMC
(Outer) Tj
EMC
`;
    const { operations } = parseContentStream(toBytes(src), 1);
    const tj = operations.filter((o) => o.operator === "Tj");
    expect(tj[0]?.mcid).toBe(2);
    expect(tj[1]?.mcid).toBe(1);
  });

  it("BMC sections do not attach an MCID (just nesting)", () => {
    const src = `/Foo BMC
(x) Tj
EMC
`;
    const { operations } = parseContentStream(toBytes(src), 1);
    const tj = operations.find((o) => o.operator === "Tj");
    expect(tj?.mcid).toBeUndefined();
  });

  it("resolves MCID from /Properties when BDC operand is a name", () => {
    // BDC's second operand can be a name referencing the page's /Properties
    // resource map instead of an inline dict.
    const src = `/Span /P1 BDC
(hello) Tj
EMC
`;
    const { operations } = parseContentStream(toBytes(src), 1, {
      properties: {
        P1: { MCID: { kind: "int", value: 42 } },
      },
    });
    const tj = operations.find((o) => o.operator === "Tj");
    expect(tj?.mcid).toBe(42);
  });
});
