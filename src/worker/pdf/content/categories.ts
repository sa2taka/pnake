/**
 * Operator → category mapping from ISO 32000-2 Annex A.
 *
 * Used by the content stream parser to label each PdfOperation with
 * its PdfOpCategory so the UI can color-code rows and the
 * explanation layer can pivot off it.
 */

import type { PdfOpCategory } from "../../../shared/ir-types";

export const OPERATOR_CATEGORY: ReadonlyMap<string, PdfOpCategory> = new Map(
  // §8.4.4 graphics state operators
  [
    ["q", "graphics-state"],
    ["Q", "graphics-state"],
    ["cm", "graphics-state"],
    ["w", "graphics-state"],
    ["J", "graphics-state"],
    ["j", "graphics-state"],
    ["M", "graphics-state"],
    ["d", "graphics-state"],
    ["ri", "graphics-state"],
    ["i", "graphics-state"],
    ["gs", "graphics-state"],

    // §8.5.2 path construction
    ["m", "path-construct"],
    ["l", "path-construct"],
    ["c", "path-construct"],
    ["v", "path-construct"],
    ["y", "path-construct"],
    ["h", "path-construct"],
    ["re", "path-construct"],

    // §8.5.3 path painting
    ["S", "path-paint"],
    ["s", "path-paint"],
    ["f", "path-paint"],
    ["F", "path-paint"],
    ["f*", "path-paint"],
    ["B", "path-paint"],
    ["B*", "path-paint"],
    ["b", "path-paint"],
    ["b*", "path-paint"],
    ["n", "path-paint"],

    // §8.5.4 clipping
    ["W", "clipping"],
    ["W*", "clipping"],

    // §9.4 text object
    ["BT", "text-object"],
    ["ET", "text-object"],

    // §9.3 text state
    ["Tc", "text-state"],
    ["Tw", "text-state"],
    ["Tz", "text-state"],
    ["TL", "text-state"],
    ["Tf", "text-state"],
    ["Tr", "text-state"],
    ["Ts", "text-state"],

    // §9.4.2 text positioning
    ["Td", "text-positioning"],
    ["TD", "text-positioning"],
    ["Tm", "text-positioning"],
    ["T*", "text-positioning"],

    // §9.4.3 text showing
    ["Tj", "text-show"],
    ["TJ", "text-show"],
    ["'", "text-show"],
    ['"', "text-show"],

    // §8.6 color
    ["CS", "color"],
    ["cs", "color"],
    ["SC", "color"],
    ["SCN", "color"],
    ["sc", "color"],
    ["scn", "color"],
    ["G", "color"],
    ["g", "color"],
    ["RG", "color"],
    ["rg", "color"],
    ["K", "color"],
    ["k", "color"],

    // §8.8 XObjects
    ["Do", "xobject"],

    // §8.9.7 inline images
    ["BI", "image-inline"],
    ["ID", "image-inline"],
    ["EI", "image-inline"],
    ["BI/EI", "image-inline"], // synthetic operator from parseContentStream

    // §7.10 shadings
    ["sh", "shading"],

    // §14.6 marked content
    ["BMC", "marked-content"],
    ["BDC", "marked-content"],
    ["EMC", "marked-content"],
    ["MP", "marked-content"],
    ["DP", "marked-content"],

    // §14.10 compatibility
    ["BX", "compatibility"],
    ["EX", "compatibility"],

    // §9.6.5 Type 3 font glyph
    ["d0", "type3-font"],
    ["d1", "type3-font"],
  ] satisfies [string, PdfOpCategory][],
);

export function categorizeOperator(op: string): PdfOpCategory {
  return OPERATOR_CATEGORY.get(op) ?? "unknown";
}
