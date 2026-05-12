# Data Model — IR (Intermediate Representation)

このドキュメントは pnake の IR 型を定義する Single Source of Truth。
コード上の `src/shared/ir-types.ts` は **このドキュメントに従う**。乖離した場合は
このドキュメントを真とする（または同時に更新する PR にする）。

設計原則は `lossless-ir-design` スキルに従う。

## 設計原則（要約）

1. **Provenance を切らない** — すべてのノードに `byteRange` または `objectRef` を持たせる
2. **3 段階の意味付け** — `raw` / `decoded` / `explained` を分離
3. **Lazy** — stream の中身は manifest に含めない。`StreamHandle` で参照する
4. **Linkable** — `id` は文字列の安定キー。クロスビューでジャンプ可能にする

## トップレベル

```ts
type PdfAnalysis = {
  fileInfo: PdfFileInfo;
  fileStructure: PdfFileStructure;
  objectsIndex: Record<ObjectId, PdfObjectSummary>;  // 中身は lazy fetch
  documentTree: PdfDocumentTree;
  pages: PdfPageSummary[];                            // 詳細は lazy fetch
  warnings: PdfWarning[];
};

type ObjectId = string; // "obj:12:0" (= num:gen)
```

`PdfAnalysis` は manifest 兼ルート。サイズが膨らまないよう、各セクションは要約のみ。

## File 情報

```ts
type PdfFileInfo = {
  byteSize: number;
  sha256: string;
  pdfVersion: string;          // "1.7" / "2.0"
  encrypted: boolean;
  linearized: boolean;
  incrementalUpdates: number;  // 0 = 単一 body
  tagged: boolean;             // StructTreeRoot の有無
  acroForm: boolean;
  xfa: boolean;
  signatures: number;
  embeddedFiles: number;
  hasJavaScript: boolean;
};
```

## File Structure

```ts
type PdfFileStructure = {
  header: { range: ByteRange; raw: string };  // "%PDF-1.7" 等
  bodies: PdfBody[];                           // incremental update ごと
  eofMarkers: ByteRange[];
};

type PdfBody = {
  index: number;                  // 0-indexed
  range: ByteRange;
  xref: PdfXref;
  trailer: PdfTrailer;
  startxrefOffset: number;
};

type PdfXref =
  | { kind: "table"; range: ByteRange; entries: PdfXrefEntry[] }
  | { kind: "stream"; range: ByteRange; objectRef: ObjectId };

type PdfXrefEntry = {
  objectNumber: number;
  generation: number;
  type: "n" | "f" | "compressed";
  offset?: number;
  compressedIn?: ObjectId;  // type === "compressed"
  indexInStream?: number;
};

type PdfTrailer = {
  range: ByteRange;
  dict: PdfDict;  // raw
};
```

## Object Graph

```ts
type PdfObjectSummary = {
  id: ObjectId;
  number: number;
  generation: number;
  byteRange: ByteRange;
  type: PdfObjectKind;
  hint?: string;        // 短い識別文字列 "Catalog" "Page#1" "Font /F1" 等
  inObjectStream?: ObjectId;
  hasStream: boolean;
};

type PdfObjectKind =
  | "catalog" | "pages" | "page" | "resources"
  | "font" | "fontDescriptor" | "encoding"
  | "xobjectImage" | "xobjectForm"
  | "extGState" | "colorSpace" | "pattern" | "shading"
  | "annot" | "structTreeRoot" | "structElem"
  | "metadata" | "embeddedFile" | "outlines"
  | "acroForm" | "signature"
  | "contentStream" | "objectStream" | "xrefStream"
  | "other";

// Detail（lazy fetch）
type PdfObjectDetail = PdfObjectSummary & {
  dict?: PdfDict;        // 解決済み
  stream?: StreamHandle;
  rawText?: string;      // raw bytes の textual representation
};
```

## 値型

PDF の COS 値を IR で表現する。

```ts
type PdfValue =
  | { kind: "null" }
  | { kind: "bool"; value: boolean }
  | { kind: "int"; value: number }
  | { kind: "real"; value: number }
  | { kind: "name"; value: string }                     // "/Foo"
  | { kind: "string"; raw: Uint8Array; text?: string }  // text は decode 試行結果
  | { kind: "array"; items: PdfValue[] }
  | { kind: "dict"; entries: Record<string, PdfValue> }
  | { kind: "ref"; target: ObjectId }
  | { kind: "stream"; dict: PdfDict; handle: StreamHandle };

type PdfDict = Record<string, PdfValue>;

type StreamHandle = {
  objectRef: ObjectId;
  filters: PdfFilter[];     // ["FlateDecode", "DCTDecode"] 等
  length: number;           // raw length (filtered)
  decodedLength?: number;   // 展開済みなら
};

type PdfFilter =
  | "FlateDecode" | "DCTDecode" | "JPXDecode" | "CCITTFaxDecode"
  | "LZWDecode" | "ASCII85Decode" | "ASCIIHexDecode" | "RunLengthDecode"
  | "JBIG2Decode" | "Crypt" | { kind: "unknown"; name: string };
```

## Document Tree

```ts
type PdfDocumentTree = {
  catalogRef: ObjectId;
  metadata?: ObjectId;        // /Metadata (XMP)
  info?: ObjectId;            // trailer /Info
  pagesRootRef: ObjectId;
  outlinesRef?: ObjectId;
  acroFormRef?: ObjectId;
  structTreeRootRef?: ObjectId;
  namesRef?: ObjectId;
  embeddedFiles?: { name: string; objectRef: ObjectId }[];
};
```

## Page

```ts
type PdfPageSummary = {
  pageNumber: number;        // 1-indexed
  objectRef: ObjectId;
  boxes: PdfPageBoxes;
  rotation: 0 | 90 | 180 | 270;
  userUnit: number;
  resourceRef: ObjectId;
  contentStreamRefs: ObjectId[];
  annotationRefs: ObjectId[];
};

type PdfPageBoxes = {
  mediaBox: PdfRect;
  cropBox?: PdfRect;
  bleedBox?: PdfRect;
  trimBox?: PdfRect;
  artBox?: PdfRect;
};

type PdfRect = { x: number; y: number; w: number; h: number };
type ByteRange = { start: number; end: number };

// Detail (lazy fetch)
type PdfPageAnalysis = {
  page: PdfPageSummary;
  resources: PdfResolvedResources;
  operations: PdfOperation[];
  visualElements: PdfVisualElement[];
  warnings: PdfWarning[];
};
```

## Content Stream Operation

これが本ツールの中心的データ。**「クリックして説明を読む」単位**。

```ts
type PdfOperation = {
  id: string;                      // "page:1:op:42"
  sequence: number;
  operator: string;                // "w" "Tj" "Do" 等
  operands: PdfValue[];
  category: PdfOpCategory;
  rawRange: ByteRange;             // raw stream 内
  decodedRange?: ByteRange;        // decoded stream 内
  stateBefore: GraphicsStateSnapshot;
  stateAfter: GraphicsStateSnapshot;
  bbox?: PdfRect;                  // 描画結果の概算範囲
  resourceRefs?: ObjectId[];       // /Font /XObject 等の参照
  explanation: PdfExplanation;
  warnings?: PdfWarning[];
};

type PdfOpCategory =
  | "graphics-state"   // q Q cm w J j M d i gs
  | "path-construct"   // m l c v y h re
  | "path-paint"       // S s f F f* B b n
  | "clipping"         // W W*
  | "text-object"      // BT ET
  | "text-state"       // Tc Tw Tz TL Tf Tr Ts
  | "text-positioning" // Td TD Tm T*
  | "text-show"        // Tj TJ ' "
  | "color"            // CS cs SC SCN sc scn G g RG rg K k
  | "xobject"          // Do
  | "image-inline"     // BI ID EI
  | "shading"          // sh
  | "marked-content"   // BMC BDC EMC MP DP
  | "compatibility"    // BX EX
  | "type3-font"       // d0 d1
  | "unknown";
```

## Graphics State Snapshot

operator 実行前後のスナップショット。UI でタイムライン表示する。

```ts
type GraphicsStateSnapshot = {
  ctm: Matrix;
  lineWidth: number;
  lineCap: number;
  lineJoin: number;
  miterLimit: number;
  dashPattern: { array: number[]; phase: number };
  renderIntent: string;
  strokeColor: PdfColor;
  fillColor: PdfColor;
  alphaStroke: number;
  alphaFill: number;
  blendMode: string;
  clipPathStack: number;    // 深さのみ
  text?: TextStateSnapshot; // BT 内のみ
};

type Matrix = [number, number, number, number, number, number]; // a b c d e f

type TextStateSnapshot = {
  charSpace: number;        // Tc
  wordSpace: number;        // Tw
  horizScale: number;       // Tz
  leading: number;          // TL
  fontKey?: string;         // resources での name
  fontRef?: ObjectId;
  fontSize: number;         // Tf 2nd operand
  renderMode: number;       // Tr
  rise: number;             // Ts
  textMatrix: Matrix;       // Tm
  lineMatrix: Matrix;
};

type PdfColor =
  | { space: "DeviceGray"; v: [number] }
  | { space: "DeviceRGB"; v: [number, number, number] }
  | { space: "DeviceCMYK"; v: [number, number, number, number] }
  | { space: "named"; spaceName: string; values: number[] }
  | { space: "pattern"; patternName: string };
```

## Resource Index

```ts
type PdfResolvedResources = {
  fonts: Record<string, PdfFontResource>;       // "/F1" -> ...
  xobjects: Record<string, PdfXObjectResource>;
  extGStates: Record<string, ObjectId>;
  colorSpaces: Record<string, ObjectId>;
  patterns: Record<string, ObjectId>;
  shadings: Record<string, ObjectId>;
  procSets: string[];
};

type PdfFontResource = {
  objectRef: ObjectId;
  subtype: "Type0" | "Type1" | "Type3" | "MMType1" | "TrueType" | "CIDFontType0" | "CIDFontType2";
  baseFont: string;
  embedded: boolean;
  toUnicode: boolean;
  encoding?: string;
};

type PdfXObjectResource = {
  objectRef: ObjectId;
  subtype: "Image" | "Form" | "PS";
  // Image
  width?: number;
  height?: number;
  colorSpace?: string;
  bitsPerComponent?: number;
  filters?: PdfFilter[];
};
```

## Visual Element

実描画 overlay 用。`PdfOperation` を集約して bbox 単位にしたもの。

```ts
type PdfVisualElement = {
  id: string;
  kind: "text-run" | "image" | "path" | "form-xobject" | "annotation" | "clip";
  bbox: PdfRect;
  zIndex: number;
  sourceOperationIds: string[];   // 戻りリンク
  preview?: string;               // text run なら decode 試行した文字列
};
```

## Explanation

3 段階表示。`UI_SPEC.md` の Detail Panel に対応。

```ts
type PdfExplanation = {
  human: string;       // "ここで線の太さを 2 にしています"
  technical: string;   // "Operator: w / Operand: 2 / Graphics state: lineWidth = 2"
  raw: string;         // "2 w"
  specRef?: PdfSpecReference;
  relatedNodeIds?: string[];
};

type PdfSpecReference = {
  spec: "ISO-32000-2" | "ISO-32000-1";
  section: string;     // "8.4.3"
  title?: string;
  url?: string;        // 著作権上、公式 URL を持つ場合のみ
};
```

## Warning

```ts
type PdfWarning = {
  id: string;
  severity: "info" | "warn" | "error";
  category:
    | "structure" | "xref" | "stream" | "filter" | "font"
    | "encoding" | "color" | "security" | "performance" | "unsupported";
  message: string;
  hint?: string;
  byteRange?: ByteRange;
  relatedNodeIds?: string[];
};
```

## ID 命名規則

| 種類 | 例 |
|---|---|
| Object | `obj:12:0` |
| Page | `page:1` |
| Page resource | `page:1:res:font:F1` |
| Content stream operation | `page:1:op:42` |
| Visual element | `page:1:vis:text:7` |
| Warning | `warn:0xabcd` (連番ハッシュ) |

ID は安定キー。再解析しても同じ入力なら同じ ID を再現することを目標にする
（できない部分はその旨ドキュメントに記す）。

## 拡張ガイドライン

新しい属性を IR に追加する場合は以下を満たす:

1. 既存属性に追加情報なら **既存型を拡張**（新規型を増やさない）
2. provenance を切らない（byteRange / objectRef / parent ID のどれかを必ず持つ）
3. lazy 化できないか先に検討（manifest を肥大化させない）
4. このドキュメントを **同じ PR で** 更新する
