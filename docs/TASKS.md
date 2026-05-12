# Tasks

Roadmap の各 Phase を **AI が自律的に実装できる粒度** に分解したもの。
チェックを進めながら作業し、必要に応じて Phase 2 以降をさらに細分化する。

各タスクには **成果物** と **DoD** を併記。粒度が大きいものは subtask に割る。

---

## Phase 0: Foundation

### T0.1 リポジトリ初期化
- 成果物: `package.json` / `tsconfig.json` / `vite.config.ts` / `index.html` / `src/main.tsx`
- DoD: `pnpm dev` でブラウザに "pnake" と表示

依存（最小）:
- `react`, `react-dom`
- `pdfjs-dist`
- dev: `vite`, `typescript`, `@types/react`, `@types/react-dom`, `vitest`, `@vitest/ui`, `eslint`, `prettier`

### T0.2 Worker bundle 設定
- 成果物: `src/worker/index.ts` + main thread からの呼出 facade `src/ui/workerClient.ts`
- DoD: main → worker → main の ping-pong がテストで通る

### T0.3 共有型の骨格
- 成果物: `src/shared/ir-types.ts`, `src/shared/protocol.ts`
- DoD: `DATA_MODEL.md` の主要型と一致。コンパイル通る

### T0.4 テスト・CI
- 成果物: `.github/workflows/ci.yml`（または相当）, vitest 設定, eslint, prettier
- DoD: `pnpm test`, `pnpm lint`, `pnpm typecheck` が緑

### T0.5 ベース UI シェル
- 成果物: Toolbar / Tree / Render / Detail / BottomDrawer の空コンポーネント
- DoD: レイアウトが `UI_SPEC.md` 通り。リサイズ可能

---

## Phase 1: PDF Object Explorer

### T1.1 Tokenizer（低レベル）
- 成果物: `src/worker/pdf/tokenize/lexer.ts`
- 対象トークン: comment, name, string(literal/hex), int/real, bool, null, dict 区切り, array 区切り, keyword, stream/endstream
- DoD:
  - 単体テスト: 仕様の各サンプルを正しくトークン化（30+ ケース）
  - byte offset を返す
  - 不正バイト列でも crash せず error token を返す
- 参照: `binary-parser-design` スキル

### T1.2 Indirect object reader
- 成果物: `src/worker/pdf/objects/reader.ts`
- 内容: `N G obj … endobj` の検出、stream 開始/終了の判定（`/Length` ヒントと endstream 探索）
- DoD: テストフィクスチャ群（自前生成）で 100% pass

### T1.3 xref table parser
- 成果物: `src/worker/pdf/structure/xref-table.ts`
- DoD: subsections / free objects / generation を正しく読む

### T1.4 xref stream parser
- 成果物: `src/worker/pdf/structure/xref-stream.ts`
- 内容: cross-reference stream の `/W` 配列ベース decode
- DoD: 仕様サンプルで pass

### T1.5 Trailer / startxref
- 成果物: `src/worker/pdf/structure/trailer.ts`
- DoD: incremental update の trailer chain を辿れる

### T1.6 FlateDecode 実装
- 成果物: `src/worker/pdf/streams/flate.ts`
- 実装: 標準 `DecompressionStream` を使う（Workers でも使える）
- DoD: `/Predictor` 12 のような PNG predictor も対応（ヘルパー込み）

### T1.7 Object stream 展開
- 成果物: `src/worker/pdf/structure/object-stream.ts`
- DoD: `/Type /ObjStm` 内の各オブジェクトを取り出せる

### T1.8 Manifest builder
- 成果物: `src/worker/pdf/structure/manifest.ts`
- 内容: T1.1〜T1.7 を統合し `PdfAnalysis` の File / FileStructure / objectsIndex / documentTree / pages（要約のみ）を作る
- DoD: サンプル PDF 群で snapshot test

### T1.9 Worker protocol — load / object detail
- 成果物: `src/worker/index.ts` のメッセージハンドラ
- DoD: `load(bytes)` → manifest, `getObjectDetail(id)` → detail がテストで通る
- 参照: `web-worker-orchestration` スキル

### T1.10 Tree Panel — Objects / File mode
- 成果物: `src/ui/panels/TreePanel/`
- DoD: 200 オブジェクトの PDF を 16ms 以下で初回描画。クリックで `selectedNodeId` が更新

### T1.11 Detail Panel — Raw / Technical
- 成果物: `src/ui/panels/DetailPanel/`
- DoD: object 選択時に raw / decoded dict が表示。tab 切替動作

### T1.12 Bottom Drawer — Raw bytes / Decoded stream
- 成果物: `src/ui/panels/BottomDrawer/`
- DoD: 選択 object の byte range を hex+ASCII 表示。stream 持ちは decoded もタブで

### T1.13 Warnings の最低限
- 成果物: warnings の収集と Warnings View 用 tree mode
- DoD: 既知の warnings カテゴリ（broken xref / unknown filter / decompression too large）を出せる

### T1.14 Phase 1 E2E テスト
- 成果物: `tests/e2e/phase1.test.ts`（Playwright 不要、jsdom + worker mock でよい）
- DoD: 「PDF をロード → tree が出る → object 選択 → raw 表示」が通る

---

## Phase 2: Page Content Stream Explorer

### T2.1 PDF.js セットアップ（render only）
- 成果物: `src/pdfjs/renderer.ts`
- DoD: 任意ページを canvas に描画

### T2.2 Pages tree resolver
- 成果物: `src/worker/pdf/structure/pages-tree.ts`
- 内容: inheritance（Resources, MediaBox 等）対応
- DoD: 1000 ページ PDF（深い tree）で正しく解決

### T2.3 Content stream tokenizer
- 成果物: `src/worker/pdf/content/tokenizer.ts`
- 内容: operand を stack に積み、operator を見たら 1 operation 確定
- DoD: 仕様の各 operator サンプルで pass

### T2.4 Operator category mapper
- 成果物: `src/worker/pdf/content/categories.ts`
- DoD: 仕様の全 operator が category に分類される

### T2.5 Tree Panel — Pages / Content mode
- DoD: ページごとに operator timeline が出る。q...Q / BT...ET でネスト

### T2.6 Operator trace タブ
- 成果物: `src/ui/panels/BottomDrawer/OperatorTrace.tsx`
- DoD: 選択 operator にハイライト

### T2.7 Phase 2 E2E テスト
- DoD: 「ページ選択 → operator が出る → operator 選択 → Tree と Bottom が同期」

---

## Phase 3: Graphics State + Resources + Overlay

### T3.1 Graphics state simulator
- 成果物: `src/worker/pdf/content/gs-simulator.ts`
- DoD: q/Q stack, CTM, line width, color, text state, clipping depth を正しく追跡

### T3.2 Resource resolver
- 成果物: `src/worker/pdf/resources/`
- DoD: 主要 Font subtype（Type1/Type0/TrueType）と Image/Form XObject を resolve

### T3.3 ToUnicode CMap decoder
- 成果物: `src/worker/pdf/resources/cmap.ts`
- DoD: 主要なケース（identity-H, embedded CMap）で text 復元

### T3.4 Visual element builder
- 成果物: `src/worker/pdf/content/visual-elements.ts`
- DoD: text-run / image / path / form-xobject の bbox が出る

### T3.5 SVG overlay
- 成果物: `src/ui/overlay/`
- DoD: Render Panel で overlay 表示、クリック / hover が動く

### T3.6 Selection sync（Tree ↔ Overlay ↔ Detail）
- DoD: 任意の origin からの選択が他 3 ペインに伝播

### T3.7 Explanation dictionary
- 成果物: `src/shared/pdf-spec.ts` に operator/object 説明
- DoD: 主要 operator 50+ に Human 説明あり

### T3.8 Phase 3 E2E
- DoD: 「描画上の文字をクリック → 該当 operator が選択 → Detail Human タブが表示」

---

## Phase 4 以降

詳細は Phase 3 完了後に分解する。骨子は `ROADMAP.md` を参照。

導入時の検討項目:
- 仮想化ライブラリの是非（react-arborist vs 自前）
- WASM 採用判断（`wasm-integration` スキル）
- 暗号化 PDF（WebCrypto）
- 修復ヒューリスティック

---

## 横断タスク

このセクションは Phase をまたいで継続的に行う。

### TX.1 サンプル PDF コレクション
- 場所: `tests/fixtures/`
- 内容: 小さい正常 PDF / 壊れた xref / 暗号化 / object streams / incremental update / tagged PDF / 各種 filter / 巨大画像 / 不正な stream length / ...
- 自前で生成スクリプトを書く（外部依存禁止）

### TX.2 説明文の整備
- `src/shared/pdf-spec.ts` を継続的に充実
- 仕様参照を付ける（ISO 32000-2 のセクション番号）

### TX.3 パフォーマンス計測
- 100MB / 500MB PDF での initial manifest 時間と peak memory を継続計測

---

## 着手前チェックリスト

新しいタスクに取り掛かる前に:

- [ ] このタスクの DoD を読んだ
- [ ] 関連スキルを開いた（`binary-parser-design` 等）
- [ ] `DATA_MODEL.md` で必要な型を確認した
- [ ] 既存テストを実行して緑であることを確認
- [ ] 仕様駆動で先にテストを書く（`tdd` スキル）
