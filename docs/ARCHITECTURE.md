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

  core/                  # transport-neutral domain logic
    parser-session.ts    # PDF parsing session (shared by Worker / InProcess)
    lru-cache.ts         # decoded-stream cache

  shared/                # main / worker 共有
    protocol.ts          # メッセージ型
    ir-types.ts          # IR 型（DATA_MODEL.md と同期）
    pdf-spec.ts          # operator 表、filter 表など仕様データ

  pdfjs/                 # PDF.js wrapper（render 専用）
```

`ui/` は `worker/` を直接 import せず、`core/` か `shared/` を経由する。
`worker/index.ts` も `core/parser-session.ts` を呼ぶ薄い transport adapter。

## 解析パイプライン

Analyzer Worker 内の処理順序（詳細は `binary-parser-design` スキル）:

1. **Load** — bytes 受領、hash、size、header、EOF 検出、linearized hint 確認
2. **File structure** — xref table / xref stream / trailers / incremental updates / object streams
3. **Object graph** — indirect objects（lazy stream 参照のみ持つ）
4. **Document graph** — Catalog → Pages tree → page inheritance → resources → ...
5. **On demand: stream decode** — filter chain を遅延展開
6. **On demand: page analysis** — content stream を tokenize → operator list → GS simulate
7. **Explanation attach** — operator dict / object type 説明 / warnings / cross-links
8. **Visual element index** — bbox 付き visual element を生成（overlay 用）

### Lazy decoding 原則

- Manifest 段階では stream 内容は読まない（dictionary だけ）
- ノードクリック / ページ選択時に必要なものだけ decode
- decode 結果は Worker 内 LRU cache（メモリ上限あり）

## ライブラリ境界

**Worker から外に出さないもの**:

- PDF の raw ArrayBuffer（大きい）
- decoded stream（必要な抜粋だけ送る）
- 一時的な解析中間データ

**Worker から UI に送るもの**:

- IR の断片（serializable, structured clone 可能な形）
- 画像プレビューは `ImageBitmap` を Transferable で
- ハイライト用の byte range と string 抜粋

## エラー設計

- 「致命的に解析不可能」と「壊れているが部分的に読める」を分ける
- 後者は `warnings: PdfWarning[]` として IR に乗せ、UI で可視化
- catch & swallow しない。Warning として表面化する

詳細は `lossless-ir-design` スキル参照。

## 関連ドキュメント

- データ型: `DATA_MODEL.md`
- 画面: `UI_SPEC.md`
- フェーズ: `ROADMAP.md`
- タスク: `TASKS.md`
- 設計判断: `DECISIONS.md`
