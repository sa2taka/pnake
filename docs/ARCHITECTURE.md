# Architecture

このドキュメントは pnake の **全体構造** を定義する。各モジュールの責務、レイヤー分離、
Worker 分割、データフローを記述する。具体的な型は `DATA_MODEL.md`、UI は `UI_SPEC.md`、
実装手順は `TASKS.md` を参照。

## レイヤー

```
┌─────────────────────────────────────────────────────────────┐
│ UI Layer (React, main thread)                                │
│   - Tree / Render / Detail / BottomDrawer                   │
│   - Selection state, view-mode state                         │
│   - SVG overlay computation                                  │
└──────────────▲──────────────────────────────────────────────┘
               │ typed messages (request/response/stream)
┌──────────────┴──────────────────────────────────────────────┐
│ Analyzer Worker (parser-worker, separate thread)            │
│   - Tokenizer / Lexer                                        │
│   - File structure parser (xref / trailer / incremental)    │
│   - Object graph builder (indirect refs, object streams)    │
│   - Stream decoder (lazy; FlateDecode, DCTDecode, ...)      │
│   - Content stream tokenizer + interpreter                  │
│   - Graphics state simulator                                 │
│   - Resource resolver                                        │
│   - Explanation layer attacher                              │
└──────────────▲──────────────────────────────────────────────┘
               │
┌──────────────┴──────────────────────────────────────────────┐
│ Render Worker (PDF.js's own worker)                          │
│   - ページ描画（参照用）                                       │
│   - 自前解析の結果と差し替えない                                │
└─────────────────────────────────────────────────────────────┘
```

### 各レイヤーの責務

**UI Layer**

- 解析ロジックは持たない。Worker からの IR を表示するだけ
- 状態管理: 「現在選択中のノード ID」「現在のビューモード」「現在のページ番号」
  「展開済みツリー」「フィルタ条件」程度。Redux 等は不要
- 重い計算（座標変換、検索）は Worker に投げる。例外は overlay の SVG 配置計算のみ

**Analyzer Worker**

- メインスレッドからの message を受け、IR の断片を返す
- 状態を持つ（PDF を 1 ファイル分ロード中）
- すべての parser ロジックがここに集約する
- 詳細プロトコルは `web-worker-orchestration` スキル参照

**Render Worker (PDF.js)**

- 純粋にページ画像を出すだけ
- 描画結果から逆引きしない（自前 IR が source of truth）

## データフロー

```
1. User: File を drop
2. UI:   File → ArrayBuffer
3. UI →  Analyzer Worker: { type: "load", bytes }
4. Worker:
     - Header / EOF 検出
     - xref / trailer 探索
     - Catalog 解決
     - Pages tree 列挙（page object ref のみ、中身は lazy）
     - 軽量な File Manifest を生成
5. Worker → UI: { type: "manifest", manifest }
6. UI:   ツリー表示、ページ 1 をデフォルト選択
7. UI →  Analyzer Worker: { type: "page", pageNumber: 1 }
8. Worker:
     - 該当 Page object 取得
     - Contents stream 取得 → decode → tokenize → operator list
     - graphics state を simulate して各 op に bbox / state snapshot 付与
     - resource 解決（font, xobject, ...）
     - Explanation を attach
9. Worker → UI: { type: "page-analysis", pageNumber, analysis }
10. 並行: UI → PDF.js Worker でページレンダリング
11. UI:   canvas に画像、SVG overlay を IR から生成
12. User: overlay 要素をクリック
13. UI:   該当 operator/object を選択 → Detail Panel と Tree を同期
```

## モジュール分割（予定）

実装はまだだが、コードは以下の境界で分ける。

```
src/
  ui/                    # main thread only
    panels/
      TreePanel/
      RenderPanel/
      DetailPanel/
      BottomDrawer/
    overlay/             # SVG overlay generator (pure function: IR → SVG)
    state/               # selection / view-mode (no logic)
    services/            # ParserService abstraction (Worker / InProcess)
    workerClient.ts      # Worker への型付き facade

  worker/                # transport adapter for the parser worker
    index.ts             # message dispatcher (thin)
    pdf/
      io/                # ByteReader
      lex/               # PDF tokenizer + lookahead stream
      parse/             # value parser, indirect object reader
      structure/         # xref / trailer / manifest / struct-tree / recovery
      streams/           # filter decoders (FlateDecode + predictors etc.)
      content/           # content stream parser, GS simulator, visual elements
      resources/         # font / xobject / extgstate / ToUnicode CMap

  core/                  # transport-agnostic parser session
    parser-session.ts    # ParserSession（Worker と InProcess の両方から呼ばれる）
    lru-cache.ts         # decoded-stream cache

  shared/                # main / worker 共有
    protocol.ts          # メッセージ型（RpcMethods から派生）
    ir-types.ts          # IR 型（DATA_MODEL.md と同期）
    pdf-spec.ts          # operator 表、filter 表など仕様データ

  pdfjs/                 # PDF.js wrapper（render 専用）
```

依存方向の前提:

- `ui/` は `worker/` を直接 import せず、`core/` か `shared/` を経由する
- `worker/index.ts` は `core/parser-session.ts` を呼ぶ薄い transport adapter
- `core/parser-session.ts` は **transport には依存しない** が、`worker/pdf/**` の
  パーサモジュール群には直接依存する（"transport-neutral" であって "engine-neutral"
  ではない）。Worker から InProcess に倒したい場合のスイッチ点はここ

### 新規参画者向けの読書順

1. `App.tsx` → `Shell.tsx` で UI の骨格
2. `ui/state/AppContext.tsx` で reducer と 3 つの context split
3. `ui/services/parser-service.ts` の `ParserService` interface
4. `ui/workerClient.ts` で typed RPC facade
5. `worker/index.ts` で dispatcher（switch 1 つ）
6. `core/parser-session.ts` で session lifecycle
7. `worker/pdf/structure/manifest.ts` の `parsePdf` がパーサ orchestrator

## 解析パイプライン

Worker 側の処理順序（詳細は `binary-parser-design` スキル）:

1. **Load** — bytes 受領、hash、size、header、EOF 検出、linearized hint 確認
2. **File structure** — xref table / xref stream / trailers / incremental updates / object streams
3. **Object graph** — indirect objects（lazy stream 参照のみ持つ）
4. **Document graph** — Catalog → Pages tree → page inheritance → resources → ...
5. **On demand: page analysis** — content stream を tokenize → operator list →
   resource resolve → ToUnicode CMap → visual element 構築
6. **On demand: stream decode** — `getStream` で raw / decoded を返す
7. **Explanation の組み立ては UI 側** — `shared/pdf-spec.ts` の静的データを引いて
   Detail Panel が表示時に組み立てる（IR には乗せない）

### Lazy decoding 原則

- Manifest 段階では stream 内容は読まない（dictionary だけ）
- ノードクリック / ページ選択時に必要なものだけ decode
- decode 結果は Worker 内 LRU cache（容量 32 エントリ、`core/lru-cache.ts`）

## ライブラリ境界

**Worker から UI に送るもの**:

- IR の断片（structured clone 可能な形）
- `getStream` の結果は `ArrayBuffer` を Transferable で渡す（ゼロコピー移転）
- 描画は PDF.js Worker が canvas に直接行うので IR を介さない

**今は送っているが、本当は減らしたいもの**:

- 大きな PDF の `fileBytes` 全体（UI が Toolbar 経由で PDF.js に渡すために main thread で保持）
- `getStream(decoded)` の全バイト — UI が抜粋しか使わないケースでも全部送っている
  （`getStreamPreview(offset, length)` への分割は未実装）

## エラー設計

- 「致命的に解析不可能」と「壊れているが部分的に読める」を分ける
- 後者は `warnings: PdfWarning[]` として IR に乗せ、UI で可視化
- catch & swallow しない。Warning として表面化する

詳細は `lossless-ir-design` スキル参照。

## RPC

`shared/protocol.ts` に **単一の `RpcMethods` map** を置き、`WorkerRequest` と
success レスポンスの union arms はそこから派生する。新メソッド追加は 1 map entry +
`worker/index.ts` の switch + `WorkerClient` のラッパだけで済む。

```ts
interface RpcMethods {
  load: { params: { bytes: ArrayBuffer; fileName?: string }; result: LoadResult };
  getStream: { params: { objectId: ObjectId; mode: "raw" | "decoded" }; result: StreamResult };
  // ...
}
```

cancel と progress は out-of-band envelope。現状 `cancel` は client が pending Promise
を reject するだけで worker 側は no-op（要改修）。`onProgress` は surface だけ用意済みで
どちらの実装も発火していない（将来の streaming 用に置いている）。

## 関連ドキュメント

- データ型: `DATA_MODEL.md`
- 画面: `UI_SPEC.md`
- フェーズ: `ROADMAP.md`
- タスク: `TASKS.md`
- 設計判断: `DECISIONS.md`
