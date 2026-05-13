# Architecture

pnake の全体構造をまとめる。型は `DATA_MODEL.md`、画面は `UI_SPEC.md`、
タスク順は `TASKS.md`。設計判断の経緯は `DECISIONS.md` に残してある。

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
└──────────────▲──────────────────────────────────────────────┘
               │
┌──────────────┴──────────────────────────────────────────────┐
│ Render Worker (PDF.js's own worker)                          │
│   - ページ描画（参照用）                                       │
│   - 自前解析の結果と差し替えない                                │
└─────────────────────────────────────────────────────────────┘
```

### UI Layer

解析ロジックは持たない。Worker から戻ってきた IR を表示するだけ。
React の state で抱えるのは選択ノード id, view mode, 現在ページ, ツリー展開状態, フィルタ程度。
Redux は要らない。座標変換も検索も Worker に投げる。
唯一例外なのは overlay の SVG 配置計算で、これは要素ごとに小さい行列を回すだけなので main thread に残している。

### Analyzer Worker

main thread からのメッセージを受けて IR を返す。
PDF を 1 ファイル分ロード中の状態を内部に持ち、`getObjectDetail` や `getPageOperations` といった lazy fetch をそこから引く。
パーサのロジックはすべてここに集約する。
プロトコルの詳細は `shared/protocol.ts` の `RpcMethods` を見るのが早い。

### Render Worker (pdf.js)

ページ画像を canvas に出すためだけに居る。
描画結果から逆引きはしない。
IR の source of truth はあくまで自前パーサ側。

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
     - graphics state を simulate
     - resource 解決（font, xobject, ...）
9. Worker → UI: { type: "page-analysis", pageNumber, analysis }
10. 並行: UI → PDF.js Worker でページレンダリング
11. UI:   canvas に画像、SVG overlay を IR から生成
12. User: overlay 要素をクリック
13. UI:   該当 operator / object を選択、Detail Panel と Tree を同期
```

operator の human / technical 説明は IR には乗らない。
UI が `shared/pdf-spec.ts` の静的テーブルを引いて表示時に組み立てる。
worker → main の payload を小さく保つのと、説明を変えるたびに再解析しないで済ませるためにそうしている。

## モジュール分割

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

依存方向は ESLint で機械的に守っている。
`ui/` が `worker/pdf/**` を直接 import すると lint が落ちる。代わりに `core/` か `shared/` を通す。
`worker/index.ts` は `core/parser-session.ts` を叩く薄いアダプタ。
`core/parser-session.ts` は transport には依存しないが、`worker/pdf/**` のパーサには直接依存する。
"transport-neutral" だが "engine-neutral" ではない、というのは正直に書くと意味するところ。
Worker から InProcess に倒すスイッチ点はこの session 単位。

### 新しく入る人向けの読書順

`App.tsx` から `Shell.tsx` で UI 骨格を眺めたら、`ui/state/AppContext.tsx` で reducer と 3 つの context split を見る。
そのあと `ui/services/parser-service.ts` で DI 抽象、`ui/workerClient.ts` で typed RPC facade、`worker/index.ts` の dispatcher (switch 1 つ)、`core/parser-session.ts` で session の lifecycle と続けて、最後に `worker/pdf/structure/manifest.ts` の `parsePdf` を読むと parser 全体の orchestrator が分かる。

## 解析パイプライン

Worker 側の処理は次の順番で動く。

1. **Load**: bytes 受領、hash、size、header、EOF 検出、linearized hint 確認。
2. **File structure**: xref table / xref stream / trailer / incremental updates / object streams。
3. **Object graph**: indirect objects を読み込む（stream の中身は lazy なまま参照だけ持つ）。
4. **Document graph**: Catalog → Pages tree → page inheritance → resources の順で辿る。
5. **On demand: page analysis**: content stream を tokenize して operator list を作り、resource を解決し、ToUnicode CMap を読み、visual element を構築する。
6. **On demand: stream decode**: `getStream` で raw / decoded を返す。

説明レイヤは Worker には居ない。UI 側の `shared/pdf-spec.ts` が表示時に組み立てる。

### Lazy decoding 原則

Manifest 段階で stream の中身は読まない。dictionary だけ拾う。
node をクリックするか、ページを選択した時点で初めて該当 stream を decode する。
decode 結果は Worker 内の LRU cache (`core/lru-cache.ts`, 容量 32) に入れる。
2 回目の同じ要求はキャッシュから返る。

## ライブラリ境界

Worker から UI に送るのは IR の断片だけで、structured clone 可能な形に揃えている。
`getStream` の結果は `ArrayBuffer` を Transferable で渡すので、worker → main へのコピーは発生しない。
PDF.js による canvas 描画も IR を介さず canvas に直接書き込むので、ここでもデータの行き来は起きない。

ただし正直に書くと、今はまだ送りすぎている部分がある。

- 大きな PDF を読むと `fileBytes` を main thread 側で 1 本持ったままになる。これは UI が Toolbar 経由で PDF.js に渡すために手元に置いておくのが理由で、本当は `Blob` URL に逃がしたい。
- `getStream(decoded)` で全バイトを返している。UI が頭の 4KiB しか使わない場面でも全部送るので無駄が出ている。`getStreamPreview(offset, length)` 相当の API への分割が未実装。

どちらも v1 安定化前に片付けたい範囲。

## エラー設計

解析エラーは「致命的に読めない」と「壊れているが部分的には読める」の 2 種類に分けて扱う。
後者は `warnings: PdfWarning[]` として IR に乗せ、UI の Warnings ビューで一覧できる。
catch して握り潰すパターンは入れない。読めなかったということ自体を warning として表に出す。

PDF を投げ込むユーザは「壊れた PDF だから何が壊れているか知りたい」というケースが多いので、可視化は割と本質的なところ。

## RPC

`shared/protocol.ts` に `RpcMethods` という単一の map がある。`WorkerRequest` と success の `WorkerResponse` arms はこの map から派生する。
メソッドを増やすときは map に 1 entry 足し、`worker/index.ts` の switch に case を 1 つ加え、`WorkerClient` にラッパを 1 個書けば終わる。

```ts
interface RpcMethods {
  load: { params: { bytes: ArrayBuffer; fileName?: string }; result: LoadResult };
  getStream: { params: { objectId: ObjectId; mode: "raw" | "decoded" }; result: StreamResult };
  // ...
}
```

`cancel` だけは out-of-band envelope として別経路に置いている。今のところ client 側で pending Promise を reject するだけで、worker 側は no-op。
本当に止めたい場合は、`ParserSession` の hot loop に AbortToken を流すか、request ごとに worker を terminate する方式に変える必要がある。
進捗通知は今はサポートしていない。要件が出たら追加する。

## 関連ドキュメント

- データ型: [`DATA_MODEL.md`](DATA_MODEL.md)
- 画面: [`UI_SPEC.md`](UI_SPEC.md)
- フェーズ: [`ROADMAP.md`](ROADMAP.md)
- タスク: [`TASKS.md`](TASKS.md)
- 設計判断: [`DECISIONS.md`](DECISIONS.md)
