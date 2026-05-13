/**
 * Logical structure tree walker (ISO 32000-2 §14.7).
 *
 * Starting from the catalog's /StructTreeRoot, builds a PdfStructTree
 * by recursively descending /K entries. Three child kinds are
 * recognized:
 *
 *   - StructElem: another tagged element (recursive).
 *   - MCID: a marked-content identifier referencing content stream
 *     operators on a specific page.
 *   - OBJR: an indirect object reference (annotations, XObjects).
 *
 * Cycles are guarded so a broken file with /P pointing back into the
 * tree cannot lock the walker.
 */

import { expectArray, expectInt, expectName, expectRef } from "../parse/value-parser";
import { asciiString } from "../io/byte-reader";
import type {
  ObjectId,
  PdfStructTree,
  PdfStructTreeChild,
  PdfStructTreeNode,
  PdfValue,
} from "../../../shared/ir-types";
import type { IndirectObject } from "../parse/object-reader";

export type BuildStructTreeInput = {
  structTreeRootRef: ObjectId;
  objects: Map<ObjectId, IndirectObject>;
}

export function buildStructTree(input: BuildStructTreeInput): PdfStructTree | undefined {
  // The /StructTreeRoot dict itself is metadata, not an element. The actual
  // tree root lives in its /K entry.
  const obj = input.objects.get(input.structTreeRootRef);
  if (obj?.value.kind !== "dict") return undefined;
  const kEntry = obj.value.entries.K;
  if (!kEntry) return undefined;

  const visited = new Set<ObjectId>();
  visited.add(input.structTreeRootRef);

  const rootCandidate = unwrapSingleRef(kEntry);
  if (rootCandidate) {
    const root = walkElement(rootCandidate, input.objects, visited, "Document");
    if (root) return { root };
  }

  // Multiple top-level children — synthesize a wrapper.
  const wrapper: PdfStructTreeNode = {
    id: `struct:${input.structTreeRootRef}`,
    objectRef: input.structTreeRootRef,
    structureType: "Document",
    children: [],
  };
  appendChildren(wrapper, kEntry, input.objects, visited);
  return { root: wrapper };
}

function unwrapSingleRef(value: PdfValue): ObjectId | undefined {
  if (value.kind === "ref") return value.target;
  if (value.kind === "array" && value.items.length === 1) {
    const item = value.items[0];
    if (item?.kind === "ref") return item.target;
  }
  return undefined;
}

function walkElement(
  ref: ObjectId,
  objects: Map<ObjectId, IndirectObject>,
  visited: Set<ObjectId>,
  fallbackType: string,
): PdfStructTreeNode | undefined {
  if (visited.has(ref)) return undefined;
  visited.add(ref);
  const obj = objects.get(ref);
  if (obj?.value.kind !== "dict") return undefined;
  const dict = obj.value.entries;
  const structureType = expectName(dict.S) ?? fallbackType;
  const node: PdfStructTreeNode = {
    id: `struct:${ref}`,
    objectRef: ref,
    structureType,
    children: [],
  };
  const title = dict.T;
  if (title?.kind === "string") node.title = asciiString(title.raw);
  const alt = dict.Alt;
  if (alt?.kind === "string") node.alt = asciiString(alt.raw);
  const lang = dict.Lang;
  if (lang?.kind === "string") node.lang = asciiString(lang.raw);
  const actualText = dict.ActualText;
  if (actualText?.kind === "string") node.actualText = asciiString(actualText.raw);

  const kids = dict.K;
  appendChildren(node, kids, objects, visited);
  return node;
}

function appendChildren(
  node: PdfStructTreeNode,
  raw: PdfValue | undefined,
  objects: Map<ObjectId, IndirectObject>,
  visited: Set<ObjectId>,
): void {
  if (!raw) return;
  const items = raw.kind === "array" ? raw.items : [raw];
  for (const item of items) {
    const child = makeChild(item, objects, visited);
    if (child) node.children.push(child);
  }
}

function makeChild(
  value: PdfValue,
  objects: Map<ObjectId, IndirectObject>,
  visited: Set<ObjectId>,
): PdfStructTreeChild | undefined {
  if (value.kind === "int") {
    return { kind: "mcid", mcid: value.value };
  }
  if (value.kind === "dict") {
    const dict = value.entries;
    const type = expectName(dict.Type);
    if (type === "MCR") {
      // /MCID is required for a valid MCR. Defaulting to 0 used to merge
      // broken entries with the first marked-content op on the page — a
      // silent misattribution. We drop the child instead and let the caller
      // (or upstream warnings) surface it as malformed.
      const mcid = expectInt(dict.MCID);
      if (mcid == null) return undefined;
      const page = expectRef(dict.Pg);
      return page ? { kind: "mcid", mcid, page } : { kind: "mcid", mcid };
    }
    if (type === "OBJR") {
      const ref = expectRef(dict.Obj);
      const page = expectRef(dict.Pg);
      if (!ref) return undefined;
      return page ? { kind: "objr", ref, page } : { kind: "objr", ref };
    }
    // Otherwise treat as an inline struct elem.
    const next: PdfStructTreeNode = {
      id: `struct:inline:${visited.size}`,
      structureType: expectName(dict.S) ?? "Span",
      children: [],
    };
    appendChildren(next, dict.K, objects, visited);
    return { kind: "elem", node: next };
  }
  if (value.kind === "ref") {
    // Could be either a StructElem or an OBJR/MCR depending on /Type.
    const obj = objects.get(value.target);
    if (obj?.value.kind !== "dict") return undefined;
    const type = expectName(obj.value.entries.Type);
    if (type === "OBJR" || type === "MCR") {
      return makeChild(obj.value, objects, visited);
    }
    const child = walkElement(value.target, objects, visited, "Span");
    return child ? { kind: "elem", node: child } : undefined;
  }
  return undefined;
}

// Helpers re-exported so the UI can render quick info from raw struct values.
export { expectArray };
