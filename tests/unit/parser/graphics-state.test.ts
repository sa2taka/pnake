import { describe, expect, it } from "vitest";
import {
  GraphicsStateSimulator,
  IDENTITY,
  multiply,
  transformRect,
} from "../../../src/worker/pdf/content/graphics-state";
import { parseContentStream } from "../../../src/worker/pdf/content/parser";
import { toBytes } from "../../../src/worker/pdf/io/byte-reader";

function simulate(src: string) {
  const { operations } = parseContentStream(toBytes(src), 1);
  const sim = new GraphicsStateSimulator();
  return operations.map((op) => sim.apply(op));
}

describe("matrix algebra", () => {
  it("identity is the neutral element", () => {
    expect(multiply(IDENTITY, IDENTITY)).toEqual(IDENTITY);
    const m = [1, 0, 0, 1, 10, 20] as const;
    expect(multiply(IDENTITY, [...m] as never)).toEqual([...m]);
  });

  it("transformRect computes the axis-aligned bbox after a CTM", () => {
    // 90° rotation around origin.
    const rotate90 = [0, 1, -1, 0, 0, 0] as const;
    const rect = transformRect([...rotate90] as never, { x: 0, y: 0, w: 10, h: 5 });
    expect(rect.w).toBeCloseTo(5);
    expect(rect.h).toBeCloseTo(10);
  });
});

describe("GraphicsStateSimulator", () => {
  it("tracks line width through q/Q with restoration", () => {
    const events = simulate("q\n5 w\nQ\n1 w\n");
    // After `5 w` line width is 5.
    expect(events[1]?.stateAfter.lineWidth).toBe(5);
    // After Q it pops back to 1 (default), then `1 w` re-sets it.
    expect(events[2]?.stateAfter.lineWidth).toBe(1);
    expect(events[3]?.stateAfter.lineWidth).toBe(1);
  });

  it("CTM composes left-multiplicatively", () => {
    // First cm scales by 2, then translates by (10,0). The resulting CTM
    // should multiply (1,0) → (2,0) before adding translation.
    const events = simulate("2 0 0 2 0 0 cm\n1 0 0 1 10 0 cm\n");
    const ctm = events.at(-1)!.stateAfter.ctm;
    // Should be the matrix [2 0 0 2 20 0] — translation pre-multiplied through scale.
    expect(ctm[0]).toBe(2);
    expect(ctm[3]).toBe(2);
    expect(ctm[4]).toBe(20);
    expect(ctm[5]).toBe(0);
  });

  it("BT resets the text matrix", () => {
    const events = simulate("BT\n1 0 0 1 50 100 Tm\n(Hi) Tj\nET\n");
    const last = events.at(-2)!;
    expect(last.inTextObject).toBe(true);
    expect(last.stateAfter.text.textMatrix).toEqual([1, 0, 0, 1, 50, 100]);
  });

  it("Tf records font key and size", () => {
    const events = simulate("BT\n/F1 12 Tf\nET\n");
    const tf = events[1]!;
    expect(tf.stateAfter.text.fontKey).toBe("F1");
    expect(tf.stateAfter.text.fontSize).toBe(12);
  });

  it("Tz divides by 100 to get a multiplicative scale", () => {
    const events = simulate("50 Tz\n");
    expect(events[0]?.stateAfter.text.horizScale).toBe(0.5);
  });

  it("advances the text matrix after Tj so subsequent text-show ops don't overlap", () => {
    const events = simulate("BT\n/F1 10 Tf\n(AB) Tj\n(CD) Tj\nET\n");
    // Find both Tj events
    const tjs = events.filter((e) => e.operation.operator === "Tj");
    expect(tjs).toHaveLength(2);
    const firstAdvance = tjs[0]!.stateAfter.text.textMatrix[4];
    const secondAdvance = tjs[1]!.stateAfter.text.textMatrix[4];
    // After "AB" we should have advanced; "CD" should advance further.
    expect(firstAdvance).toBeGreaterThan(0);
    expect(secondAdvance).toBeGreaterThan(firstAdvance);
  });

  it("TJ applies array-form spacing adjustments to the running advance", () => {
    const events = simulate("BT\n/F1 10 Tf\n[(A) -500 (B)] TJ\nET\n");
    const tj = events.find((e) => e.operation.operator === "TJ")!;
    // Without the adjustment, advance would be 2 * 5 = 10. The -500 in
    // thousandths-of-em multiplies to +500/1000 * 10 = +5 added back.
    expect(tj.stateAfter.text.textMatrix[4]).toBeCloseTo(10 + 5);
  });
});
