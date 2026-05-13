import { describe, expect, it } from "vitest";
import { buildStructTree } from "../../../src/worker/pdf/structure/struct-tree";
import type { IndirectObject } from "../../../src/worker/pdf/parse/object-reader";
import type { ObjectId, PdfValue } from "../../../src/shared/ir-types";

function dict(entries: Record<string, PdfValue>): PdfValue {
  return { kind: "dict", entries };
}
function name(value: string): PdfValue {
  return { kind: "name", value };
}
function ref(target: string): PdfValue {
  return { kind: "ref", target: target as ObjectId };
}
function arr(items: PdfValue[]): PdfValue {
  return { kind: "array", items };
}
function int(value: number): PdfValue {
  return { kind: "int", value };
}
function str(s: string): PdfValue {
  return { kind: "string", raw: new TextEncoder().encode(s) };
}

function makeObjects(map: Record<string, PdfValue>): Map<ObjectId, IndirectObject> {
  const out = new Map<ObjectId, IndirectObject>();
  for (const [id, value] of Object.entries(map)) {
    const m = /^obj:(\d+):(\d+)$/.exec(id);
    if (!m) continue;
    const oid = id as ObjectId;
    out.set(oid, {
      id: oid,
      number: Number(m[1]),
      generation: Number(m[2]),
      range: { start: 0, end: 0 },
      value,
    });
  }
  return out;
}

describe("buildStructTree", () => {
  it("walks /K into nested struct elements", () => {
    const objects = makeObjects({
      "obj:100:0": dict({
        Type: name("StructTreeRoot"),
        K: ref("obj:101:0"),
      }),
      "obj:101:0": dict({
        S: name("Document"),
        T: str("Doc"),
        K: arr([ref("obj:102:0"), ref("obj:103:0")]),
      }),
      "obj:102:0": dict({
        S: name("H1"),
        K: arr([int(0)]),
      }),
      "obj:103:0": dict({
        S: name("P"),
        K: arr([int(1), int(2)]),
        Alt: str("Paragraph alt"),
      }),
    });
    const tree = buildStructTree({ structTreeRootRef: "obj:100:0", objects });
    expect(tree).toBeDefined();
    if (!tree) throw new Error();
    expect(tree.root.structureType).toBe("Document");
    expect(tree.root.children).toHaveLength(2);
    const [h1, p] = tree.root.children;
    expect(h1?.kind).toBe("elem");
    expect(p?.kind).toBe("elem");
    if (h1?.kind === "elem") {
      expect(h1.node.structureType).toBe("H1");
      expect(h1.node.children).toEqual([{ kind: "mcid", mcid: 0 }]);
    }
    if (p?.kind === "elem") {
      expect(p.node.alt).toBe("Paragraph alt");
      expect(p.node.children).toEqual([
        { kind: "mcid", mcid: 1 },
        { kind: "mcid", mcid: 2 },
      ]);
    }
  });

  it("recognizes /Type /MCR child entries with page references", () => {
    const objects = makeObjects({
      "obj:100:0": dict({
        Type: name("StructTreeRoot"),
        K: ref("obj:101:0"),
      }),
      "obj:101:0": dict({
        S: name("Figure"),
        K: dict({
          Type: name("MCR"),
          MCID: int(3),
          Pg: ref("obj:200:0"),
        }),
      }),
    });
    const tree = buildStructTree({ structTreeRootRef: "obj:100:0", objects });
    expect(tree?.root.children[0]).toEqual({ kind: "mcid", mcid: 3, page: "obj:200:0" });
  });

  it("recognizes /Type /OBJR (annotation reference) children", () => {
    const objects = makeObjects({
      "obj:100:0": dict({
        Type: name("StructTreeRoot"),
        K: ref("obj:101:0"),
      }),
      "obj:101:0": dict({
        S: name("Link"),
        K: dict({
          Type: name("OBJR"),
          Obj: ref("obj:500:0"),
          Pg: ref("obj:200:0"),
        }),
      }),
    });
    const tree = buildStructTree({ structTreeRootRef: "obj:100:0", objects });
    expect(tree?.root.children[0]).toEqual({
      kind: "objr",
      ref: "obj:500:0",
      page: "obj:200:0",
    });
  });

  it("breaks cycles instead of looping forever", () => {
    const objects = makeObjects({
      "obj:100:0": dict({
        Type: name("StructTreeRoot"),
        K: ref("obj:101:0"),
      }),
      "obj:101:0": dict({
        S: name("Document"),
        K: ref("obj:101:0"), // self-reference!
      }),
    });
    const tree = buildStructTree({ structTreeRootRef: "obj:100:0", objects });
    expect(tree).toBeDefined();
  });
});
