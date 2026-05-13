# Data Model (IR)

IR 型の役割と意図をまとめる。
型の本体は `src/shared/ir-types.ts` に置いていて、そちらがコード上の単一の真。
このドキュメントとコードの乖離は同じ PR で直す。コードが真の場合は doc を合わせる。

## 設計原則

何度か試行錯誤した結果、次の 5 つが落ち着いた。

1. provenance を切らない。すべてのノードは `byteRange` か `objectRef` のどちらか、または親 ID を持つ。raw bytes まで辿れない IR は採用しない。
2. raw / decoded / explained を分けて持つ。raw と decoded は IR の責務、explained は UI 側で `shared/pdf-spec.ts` の静的データを引いて組み立てる。
3. stream の中身は manifest に含めない。`StreamHandle` で参照だけ持ち、必要になった時点で worker が decode する。
4. ID は安定な文字列キーにする。`obj:12:0` のように namespace + 内容で構成し、再解析しても同じ入力なら同じ ID が出るようにする。これでクロスビューのジャンプが成り立つ。
5. payload は lean に保つ。graphics state スナップショットや operator 説明を IR に乗せると `structured-clone` のコストが膨らむので、後段で再導出するほうを優先する。

## トップレベル

```ts
type PdfAnalysis = {
  fileInfo: PdfFileInfo;
  fileStructure: PdfFileStructure;
  objectsIndex: Record<ObjectId, PdfObjectSummary>;  // 中身は lazy fetch
  documentTree?: PdfDocumentTree;                    // 致命的エラー時のみ undefined
  pages: PdfPageSummary[];                           // 詳細は lazy fetch
  formFields: PdfFormField[];
  warnings: PdfWarning[];
};

type ObjectId = string; // "obj:12:0" (= num:gen)
```

`PdfAnalysis` は manifest 兼ルート。サイズが膨らまないよう、各セクションは要約のみ持つ。
ページ毎の operations / visual elements は `getPageOperations` で別途取得する。

## File 情報

```ts
type PdfFileInfo = {
  byteSize: number;
  sha256?: string;             // 計算は best-effort
  pdfVersion: string;          // "1.7" / "2.0"
  encrypted: boolean;
  linearized: boolean;
  incrementalUpdates: number;  // 0 = 単一 body
  tagged: boolean;             // StructTreeRoot の有無
  acroForm: boolean;
  xfa: boolean;
  signatures: number;
  formFields: number;
  embeddedFiles: number;
  hasJavaScript: boolean;
};
```

## File Structure

```ts
type PdfFileStructure = {
  header: { range: ByteRange; raw: string };   // "%PDF-1.7" 等
  bodies: PdfBody[];                            // incremental update ごと
  eofMarkers: ByteRange[];
};

type PdfBody = {
  index: number;                                // 0-indexed
  range: ByteRange;
  xref: PdfXref;
  trailer: PdfTrailer;
  startxrefOffset: number;
};

type PdfXref =
  | { kind: "table"; range: ByteRange; entries: PdfXrefEntry[] }
  | { kind: "stream"; range: ByteRange; objectRef: ObjectId; entries: PdfXrefEntry[] };

type PdfXrefEntry = {
  objectNumber: number;
  generation: number;
  type: "n" | "f" | "compressed";
  offset?: number;                              // type === "n"
  compressedIn?: ObjectId;                      // type === "compressed"
  indexInStream?: number;
};

type PdfTrailer = {
  range: ByteRange;
  dict: PdfDict;                                // raw
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
  hint?: string;                                // 短い識別文字列 "Catalog" 等
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

// Detail（lazy fetch via getObjectDetail）
type PdfObjectDetail = PdfObjectSummary & {
  value: PdfValue;                              // stream は handle のみ（バイトは除外）
  rawText: string;                              // raw bytes の textual representation
};
```

## 値型

PDF の COS 値を IR で表現する。各 variant は省略可能な `range` を持ち、
パーサが populate する（手で組み立てた値や explanation 層の値では省略可）。

```ts
type PdfValue =
  | { kind: "null"; range?: ByteRange }
  | { kind: "bool"; value: boolean; range?: ByteRange }
  | { kind: "int"; value: number; range?: ByteRange }
  | { kind: "real"; value: number; range?: ByteRange }
  | { kind: "name"; value: string; range?: ByteRange }                            // "/Foo"
  | { kind: "string"; raw: Uint8Array; text?: string; hex?: boolean; range?: ByteRange }
  | { kind: "array"; items: PdfValue[]; range?: ByteRange }
  | { kind: "dict"; entries: Record<string, PdfValue>; range?: ByteRange }
  | { kind: "ref"; target: ObjectId; range?: ByteRange }
  | { kind: "stream"; dict: PdfDict; handle: StreamHandle; range?: ByteRange };

type PdfDict = Record<string, PdfValue>;

type StreamHandle = {
  objectRef: ObjectId;
  filters: PdfFilter[];                         // ["FlateDecode", "DCTDecode"] 等
  length: number;                               // raw length (filtered)
  decodedLength?: number;                       // 展開済みなら
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
  metadata?: ObjectId;                          // /Metadata (XMP)
  info?: ObjectId;                              // trailer /Info
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
  pageNumber: number;                           // 1-indexed
  objectRef: ObjectId;
  boxes: PdfPageBoxes;
  rotation: 0 | 90 | 180 | 270;
  userUnit: number;
  /** ancestor から継承された /Resources の indirect ref（直接 dict の場合は undefined） */
  resourceRef?: ObjectId;
  /** ページに直書き or ancestor で inline された /Resources dict */
  resourceDict?: PdfDict;
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
```

### Page Analysis（lazy）

`getPageOperations(pageNumber)` の返り値（`protocol.ts:PageOperationsResult`）:

```ts
type PageOperationsResult = {
  pageNumber: number;
  operations: PdfOperation[];
  warnings: PdfWarning[];
  resources: PdfResolvedResources;
  visualElements: PdfVisualElement[];
};
```

## Content Stream Operation

「クリックして説明を読む」単位。意図的に薄く保ってあって、graphics state スナップショットや人間向けの説明文は乗せない。
必要になったタイミングで parser や UI が再導出する。

```ts
type PdfOperation = {
  id: string;                                   // "page:1:op:42"
  sequence: number;
  operator: string;                             // "w" "Tj" "Do" 等
  operands: PdfValue[];
  category: PdfOpCategory;
  rawRange?: ByteRange;                         // raw content stream 内
  decodedRange?: ByteRange;                     // decoded stream 内
  resourceRefs?: ObjectId[];                    // /Font /XObject 等の参照
  /** 直近の BDC marked-content から拾った /MCID（あれば） */
  mcid?: number;
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

### Explanation はどこにあるか

UI が `shared/pdf-spec.ts` の静的な operator table を引いて表示時に組み立てる。
IR には乗せない。仕様参照 URL もここに集約する。

### Graphics State はどこにあるか

`worker/pdf/content/graphics-state.ts` の `GraphicsStateSimulator` が `process()` を呼ぶたびに内部で更新する。
ただし結果を各 operation に乗せることはしない。
UI が graphics タブを必要としたら、worker 側で simulator をもう一度走らせ、その時点のスナップショットだけ返す。
全 operation 分を抱え込まないので payload が肥大化しない。

## Resource Index

```ts
type PdfResolvedResources = {
  pageNumber: number;
  fonts: Record<string, PdfFontResource>;       // "/F1" -> ...
  xobjects: Record<string, PdfXObjectResource>;
  extGStates: Record<string, ObjectId>;
  colorSpaces: Record<string, ObjectId>;
  patterns: Record<string, ObjectId>;
  shadings: Record<string, ObjectId>;
  /** BDC/BMC marked content から名前参照される /Properties dict */
  properties: Record<string, PdfDict>;
  procSets: string[];
};

type PdfFontResource = {
  objectRef: ObjectId;
  name: string;                                 // /Resources/Font 上での name
  subtype:
    | "Type0" | "Type1" | "Type3" | "MMType1"
    | "TrueType" | "CIDFontType0" | "CIDFontType2" | "Unknown";
  baseFont?: string;
  encoding?: string;
  toUnicodeRef?: ObjectId;                      // あれば lazy decode
  embedded: boolean;
};

type PdfXObjectResource = {
  objectRef: ObjectId;
  name: string;
  subtype: "Image" | "Form" | "PS" | "Unknown";
  // Image 系
  width?: number;
  height?: number;
  colorSpace?: string;
  bitsPerComponent?: number;
  filters: PdfFilter[];
  // Form 系（§8.10）
  formBBox?: PdfRect;
  formMatrix?: Matrix;                          // 省略時は identity
};

type Matrix = [number, number, number, number, number, number];   // a b c d e f
```

## Visual Element

実描画 overlay 用。`PdfOperation` を集約して bbox 単位にしたもの。

```ts
type PdfVisualElement = {
  id: string;
  kind: "text-run" | "image" | "path" | "form-xobject" | "annotation" | "clip";
  bbox: PdfRect;
  zIndex: number;
  sourceOperationIds: string[];                 // 戻りリンク
  preview?: string;                             // text run なら decode 試行した文字列
};
```

## Logical Structure (Tagged PDF)

```ts
type PdfStructTreeNode = {
  id: string;
  objectRef?: ObjectId;
  structureType: string;                        // "P" "H1" "Figure" 等
  title?: string;
  alt?: string;
  lang?: string;
  actualText?: string;
  children: PdfStructTreeChild[];
};

type PdfStructTreeChild =
  | { kind: "elem"; node: PdfStructTreeNode }
  | { kind: "mcid"; mcid: number; page?: ObjectId }
  | { kind: "objr"; ref: ObjectId; page?: ObjectId };

type PdfStructTree = { root: PdfStructTreeNode };
```

`PdfAnalysis` には含めず、`LoadResult.structTree?: PdfStructTree` として並列に返す
（タグなし PDF では undefined）。

## Form Fields (AcroForm)

```ts
type PdfFormField = {
  objectRef: ObjectId;
  name: string;                                 // /T
  fullName: string;                             // dot-joined parent chain
  fieldType: "Tx" | "Btn" | "Ch" | "Sig" | "Unknown";
  value?: string;                               // /V
  signed: boolean;                              // /V is a /Sig dict
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

| 種類 | 例 | helper |
|---|---|---|
| Object | `obj:12:0` | `objectId(num, gen)` |
| Page | `page:1` | `pageId(pageNumber)` |
| Content stream operation | `page:1:op:42` | `operationId(pageNumber, sequence)` |
| Struct elem | `struct:elem:<obj>` / `struct:inline:<n>` | (struct-tree.ts) |
| Visual element | `vis:<kind>:<page>:<n>` | (visual-elements.ts) |
| Warning | `warn:<category>:<context>` | (parser ごと) |

ID は安定キー。同一入力に対しては同じ ID を再現することを目標にする
（`struct:inline:*` のような fallback は order-dependent なので原則 transient）。

## 拡張ガイドライン

新しい属性を IR に追加するときの確認事項。

1. 既存属性の追加情報なら、新規型を増やさず既存の型を拡張する。
2. provenance を切らない。byteRange / objectRef / parent ID のどれかは必ず持たせる。
3. lazy にできないか先に検討する。manifest が肥大化すると初期表示が遅くなる。
4. このドキュメントと `src/shared/ir-types.ts` を同じ PR で直す。コードだけ進めて doc がずれた状態を残さない。
