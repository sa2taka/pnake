/**
 * Graphics-state simulator (ISO 32000-2 §8.4, §9.3).
 *
 * Walks a sequence of PdfOperation events and tracks the q/Q stack,
 * the current transformation matrix, text state, color state, and
 * path information needed to compute bounding boxes downstream.
 *
 * State value is kept immutable per snapshot: operators mutate the
 * top-of-stack by replacing it with a new object, so callers can
 * capture before/after pairs by sampling at the right moment.
 */

import type {
  Matrix,
  PdfOperation,
  PdfRect,
  PdfValue,
} from "../../../shared/ir-types";

export interface TextState {
  charSpace: number;
  wordSpace: number;
  horizScale: number;
  leading: number;
  fontKey?: string;
  fontSize: number;
  renderMode: number;
  rise: number;
  textMatrix: Matrix;
  lineMatrix: Matrix;
}

export interface GraphicsState {
  ctm: Matrix;
  lineWidth: number;
  lineCap: number;
  lineJoin: number;
  miterLimit: number;
  text: TextState;
  clipDepth: number;
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function defaultGraphicsState(): GraphicsState {
  return {
    ctm: IDENTITY,
    lineWidth: 1,
    lineCap: 0,
    lineJoin: 0,
    miterLimit: 10,
    text: defaultTextState(),
    clipDepth: 0,
  };
}

export function defaultTextState(): TextState {
  return {
    charSpace: 0,
    wordSpace: 0,
    horizScale: 1,
    leading: 0,
    fontSize: 0,
    renderMode: 0,
    rise: 0,
    textMatrix: IDENTITY,
    lineMatrix: IDENTITY,
  };
}

// ---- Matrix math ----

export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

export function applyMatrix(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

// ---- Walker ----

export interface OperationContext {
  operation: PdfOperation;
  /** Graphics state at the moment this operator starts. */
  stateBefore: GraphicsState;
  /** Graphics state after this operator has executed. */
  stateAfter: GraphicsState;
  /** True while between BT and ET — sampled after this operator runs. */
  inTextObject: boolean;
}

export class GraphicsStateSimulator {
  private stack: GraphicsState[] = [defaultGraphicsState()];
  private inTextObject = false;

  state(): GraphicsState {
    return this.stack[this.stack.length - 1]!;
  }

  apply(op: PdfOperation): OperationContext {
    const stateBefore = this.state();
    this.process(op);
    return {
      operation: op,
      stateBefore,
      stateAfter: this.state(),
      inTextObject: this.inTextObject,
    };
  }

  private process(op: PdfOperation): void {
    switch (op.operator) {
      case "q":
        this.stack.push({ ...this.state(), text: { ...this.state().text } });
        return;
      case "Q":
        if (this.stack.length > 1) this.stack.pop();
        return;
      case "cm": {
        const m = matrixOperand(op.operands);
        if (m) this.replaceTop({ ctm: multiply(m, this.state().ctm) });
        return;
      }
      case "w":
        this.replaceTop({ lineWidth: numericOperand(op.operands[0]) ?? this.state().lineWidth });
        return;
      case "J":
        this.replaceTop({ lineCap: numericOperand(op.operands[0]) ?? this.state().lineCap });
        return;
      case "j":
        this.replaceTop({ lineJoin: numericOperand(op.operands[0]) ?? this.state().lineJoin });
        return;
      case "M":
        this.replaceTop({ miterLimit: numericOperand(op.operands[0]) ?? this.state().miterLimit });
        return;
      case "W":
      case "W*":
        this.replaceTop({ clipDepth: this.state().clipDepth + 1 });
        return;
      case "BT":
        this.inTextObject = true;
        this.replaceText({ textMatrix: IDENTITY, lineMatrix: IDENTITY });
        return;
      case "ET":
        this.inTextObject = false;
        return;
      case "Tf": {
        const fontKey = op.operands[0]?.kind === "name" ? op.operands[0].value : undefined;
        const fontSize = numericOperand(op.operands[1]);
        const patch: Partial<TextState> = {};
        if (fontKey) patch.fontKey = fontKey;
        if (fontSize != null) patch.fontSize = fontSize;
        this.replaceText(patch);
        return;
      }
      case "Tc":
        this.replaceText({ charSpace: numericOperand(op.operands[0]) ?? 0 });
        return;
      case "Tw":
        this.replaceText({ wordSpace: numericOperand(op.operands[0]) ?? 0 });
        return;
      case "Tz":
        this.replaceText({ horizScale: (numericOperand(op.operands[0]) ?? 100) / 100 });
        return;
      case "TL":
        this.replaceText({ leading: numericOperand(op.operands[0]) ?? 0 });
        return;
      case "Tr":
        this.replaceText({ renderMode: numericOperand(op.operands[0]) ?? 0 });
        return;
      case "Ts":
        this.replaceText({ rise: numericOperand(op.operands[0]) ?? 0 });
        return;
      case "Td":
      case "TD": {
        const tx = numericOperand(op.operands[0]) ?? 0;
        const ty = numericOperand(op.operands[1]) ?? 0;
        const next = multiply([1, 0, 0, 1, tx, ty], this.state().text.lineMatrix);
        if (op.operator === "TD") this.replaceText({ leading: -ty });
        this.replaceText({ textMatrix: next, lineMatrix: next });
        return;
      }
      case "Tm": {
        const m = matrixOperand(op.operands);
        if (m) this.replaceText({ textMatrix: m, lineMatrix: m });
        return;
      }
      case "T*": {
        const next = multiply(
          [1, 0, 0, 1, 0, -this.state().text.leading],
          this.state().text.lineMatrix,
        );
        this.replaceText({ textMatrix: next, lineMatrix: next });
        return;
      }
      // Text-showing operators advance the text matrix by the (approximate)
      // width of the glyphs they rendered. Without parsed font metrics we
      // use a half-em-per-character estimate, which is wrong for CJK and
      // exotic fonts but good enough for click-target hit testing.
      case "Tj": {
        const advance = approximateAdvanceForString(op.operands[0], this.state().text);
        this.advanceTextMatrix(advance);
        return;
      }
      case "TJ": {
        const advance = approximateAdvanceForTJ(op.operands[0], this.state().text);
        this.advanceTextMatrix(advance);
        return;
      }
      case "'": {
        // ` implies T* first, then Tj.
        const stateBefore = this.state();
        const lineDescent = multiply(
          [1, 0, 0, 1, 0, -stateBefore.text.leading],
          stateBefore.text.lineMatrix,
        );
        this.replaceText({ textMatrix: lineDescent, lineMatrix: lineDescent });
        const advance = approximateAdvanceForString(op.operands[0], this.state().text);
        this.advanceTextMatrix(advance);
        return;
      }
      case '"': {
        // aw ac string " — set word/char spacing, then ' behavior on the string.
        const aw = numericOperand(op.operands[0]) ?? 0;
        const ac = numericOperand(op.operands[1]) ?? 0;
        this.replaceText({ wordSpace: aw, charSpace: ac });
        const stateBefore = this.state();
        const lineDescent = multiply(
          [1, 0, 0, 1, 0, -stateBefore.text.leading],
          stateBefore.text.lineMatrix,
        );
        this.replaceText({ textMatrix: lineDescent, lineMatrix: lineDescent });
        const advance = approximateAdvanceForString(op.operands[2], this.state().text);
        this.advanceTextMatrix(advance);
        return;
      }
      default:
        // Other operators don't change the snapshot fields we track.
        return;
    }
  }

  private advanceTextMatrix(tx: number): void {
    if (tx === 0) return;
    const next = multiply([1, 0, 0, 1, tx, 0], this.state().text.textMatrix);
    this.replaceText({ textMatrix: next });
  }

  private replaceTop(patch: Partial<GraphicsState>): void {
    const top = this.state();
    this.stack[this.stack.length - 1] = { ...top, ...patch };
  }

  private replaceText(patch: Partial<TextState>): void {
    const top = this.state();
    this.stack[this.stack.length - 1] = {
      ...top,
      text: { ...top.text, ...patch },
    };
  }
}

// ---- Helpers ----

function numericOperand(value: PdfValue | undefined): number | undefined {
  if (!value) return undefined;
  if (value.kind === "int") return value.value;
  if (value.kind === "real") return value.value;
  return undefined;
}

function matrixOperand(operands: PdfValue[]): Matrix | null {
  if (operands.length < 6) return null;
  const nums = operands.slice(0, 6).map(numericOperand);
  if (nums.some((n) => n === undefined)) return null;
  return nums as Matrix;
}

/**
 * Coarse text advance for a single string operand. The result is in
 * text-space units (multiplied through textMatrix in caller). We don't have
 * font metrics here, so a half-em-per-glyph estimate is the best we can do
 * without dragging the font program parser into the simulator. Multibyte
 * fonts roughly halve the count by dividing raw.length / 2 isn't worth the
 * complexity at the simulator layer — the proper fix is to pass decoded
 * codepoint counts in from the visual-elements layer.
 */
function approximateAdvanceForString(operand: PdfValue | undefined, text: TextState): number {
  if (!operand || operand.kind !== "string") return 0;
  const glyphCount = operand.raw.length;
  return glyphCount * 0.5 * text.fontSize * text.horizScale;
}

function approximateAdvanceForTJ(operand: PdfValue | undefined, text: TextState): number {
  if (!operand || operand.kind !== "array") return 0;
  let advance = 0;
  for (const item of operand.items) {
    if (item.kind === "string") {
      advance += item.raw.length * 0.5 * text.fontSize * text.horizScale;
    } else if (item.kind === "int" || item.kind === "real") {
      // TJ adjustments are in thousandths of an em, applied to the
      // running width in the opposite direction.
      advance -= (item.value / 1000) * text.fontSize * text.horizScale;
    }
  }
  return advance;
}

export function transformRect(m: Matrix, rect: PdfRect): PdfRect {
  const corners = [
    applyMatrix(m, rect.x, rect.y),
    applyMatrix(m, rect.x + rect.w, rect.y),
    applyMatrix(m, rect.x, rect.y + rect.h),
    applyMatrix(m, rect.x + rect.w, rect.y + rect.h),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const x1 = Math.max(...xs);
  const y1 = Math.max(...ys);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
