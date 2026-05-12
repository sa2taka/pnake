/**
 * Visual element builder.
 *
 * Walks parsed operations through the GraphicsStateSimulator and
 * emits PdfVisualElement records — the data the SVG overlay clicks
 * against in the render panel.
 *
 * Bounding boxes for text runs use rough metrics (string length ×
 * 0.5 × font size × horizontal scale). Reasonable enough for
 * click-target hit testing without parsing every embedded font
 * program; we revisit when the inspector starts to need pixel
 * accuracy.
 */

import type {
  PdfOperation,
  PdfRect,
  PdfResolvedResources,
  PdfValue,
  PdfVisualElement,
  PdfWarning,
} from "../../../shared/ir-types";
import {
  GraphicsStateSimulator,
  applyMatrix,
  multiply,
  transformRect,
} from "./graphics-state";
import type { ToUnicodeCMap } from "../resources/cmap";
import { decodeWithCMap } from "../resources/cmap";
import { asciiString } from "../io/byte-reader";

export interface BuildVisualElementsInput {
  pageNumber: number;
  operations: PdfOperation[];
  resources: PdfResolvedResources;
  fontCMaps?: Map<string, ToUnicodeCMap>;
}

export interface BuildVisualElementsResult {
  elements: PdfVisualElement[];
  warnings: PdfWarning[];
}

export function buildVisualElements(
  input: BuildVisualElementsInput,
): BuildVisualElementsResult {
  const sim = new GraphicsStateSimulator();
  const elements: PdfVisualElement[] = [];
  const warnings: PdfWarning[] = [];
  let z = 0;
  let textRunIndex = 0;
  let imageIndex = 0;
  let formIndex = 0;

  for (const op of input.operations) {
    const ctx = sim.apply(op);
    switch (op.operator) {
      case "Tj":
      case "'":
      case '"': {
        const raw = readString(op.operands[op.operator === '"' ? 2 : 0]);
        const preview = previewText(raw, ctx.stateBefore.text.fontKey, input.fontCMaps);
        const bbox = textBBox(ctx.stateBefore, raw?.length ?? 1);
        if (bbox) {
          elements.push({
            id: `page:${input.pageNumber}:vis:text:${textRunIndex++}`,
            kind: "text-run",
            bbox,
            zIndex: z++,
            sourceOperationIds: [op.id],
            preview,
          });
        }
        break;
      }
      case "TJ": {
        const arr = op.operands[0];
        if (!arr || arr.kind !== "array") break;
        const strings: string[] = [];
        let chars = 0;
        for (const item of arr.items) {
          if (item.kind === "string") {
            strings.push(previewText(item.raw, ctx.stateBefore.text.fontKey, input.fontCMaps) ?? "");
            chars += item.raw.length;
          }
        }
        const bbox = textBBox(ctx.stateBefore, chars || strings.join("").length);
        if (bbox) {
          elements.push({
            id: `page:${input.pageNumber}:vis:text:${textRunIndex++}`,
            kind: "text-run",
            bbox,
            zIndex: z++,
            sourceOperationIds: [op.id],
            preview: strings.join(""),
          });
        }
        break;
      }
      case "Do": {
        const name = op.operands[0]?.kind === "name" ? op.operands[0].value : undefined;
        if (!name) break;
        const xo = input.resources.xobjects[name];
        if (!xo) {
          warnings.push({
            id: `warn:do-missing:${op.id}`,
            severity: "warn",
            category: "structure",
            message: `Page ${input.pageNumber} draws missing XObject /${name}`,
            relatedNodeIds: [op.id],
          });
          break;
        }
        const bbox = transformRect(ctx.stateBefore.ctm, { x: 0, y: 0, w: 1, h: 1 });
        elements.push({
          id:
            xo.subtype === "Form"
              ? `page:${input.pageNumber}:vis:form:${formIndex++}`
              : `page:${input.pageNumber}:vis:image:${imageIndex++}`,
          kind: xo.subtype === "Form" ? "form-xobject" : "image",
          bbox,
          zIndex: z++,
          sourceOperationIds: [op.id],
          preview: `/${name}`,
        });
        break;
      }
      case "BI/EI": {
        // Inline image: we don't know the dimensions without parsing the BI
        // dict, but the CTM still gives us a unit rectangle.
        const bbox = transformRect(ctx.stateBefore.ctm, { x: 0, y: 0, w: 1, h: 1 });
        elements.push({
          id: `page:${input.pageNumber}:vis:image:${imageIndex++}`,
          kind: "image",
          bbox,
          zIndex: z++,
          sourceOperationIds: [op.id],
        });
        break;
      }
      default:
        break;
    }
  }
  return { elements, warnings };
}

// =============================================================================
// Helpers
// =============================================================================

function textBBox(
  state: ReturnType<GraphicsStateSimulator["state"]>,
  glyphCount: number,
): PdfRect | undefined {
  const { fontSize, horizScale, textMatrix } = state.text;
  if (fontSize === 0) return undefined;
  // Approximate average glyph advance ≈ 0.5em for typical proportional fonts.
  const widthPerGlyph = 0.5 * fontSize * horizScale;
  const width = Math.max(0.1, glyphCount * widthPerGlyph);
  const height = fontSize;
  // Text origin sits at the baseline; bbox extends slightly down for descenders.
  const localRect: PdfRect = { x: 0, y: -0.2 * fontSize, w: width, h: height };
  const final = multiply(textMatrix, state.ctm);
  return transformRect(final, localRect);
}

function readString(value: PdfValue | undefined): Uint8Array | undefined {
  if (!value) return undefined;
  if (value.kind === "string") return value.raw;
  return undefined;
}

function previewText(
  raw: Uint8Array | undefined,
  fontKey: string | undefined,
  cmaps: Map<string, ToUnicodeCMap> | undefined,
): string | undefined {
  if (!raw) return undefined;
  if (fontKey && cmaps) {
    const cmap = cmaps.get(fontKey);
    if (cmap && cmap.entries.size > 0) {
      return decodeWithCMap(cmap, raw);
    }
  }
  // Fallback: best-effort ASCII / WinAnsi-ish decode.
  return printable(raw);
}

function printable(bytes: Uint8Array): string {
  const ascii = asciiString(bytes);
  // Keep non-printable bytes from cluttering the preview.
  return ascii.replace(/[\x00-\x1f\x7f-\xff]/g, "·");
}

// Make `applyMatrix` available to overlay callers.
export { applyMatrix };
