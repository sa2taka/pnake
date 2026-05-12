# pnake — PDF DevTools

## プロジェクト概要

PDF の内部構造をブラウザ上でインスペクトする「PDF 版 Chrome DevTools」を作る。
PDF ビューアではなく、解析・教育・デバッグツール。pdfinfo 相当の情報を **すべて**、
**非専門家にも分かる説明レイヤー付き** で提示することを目標にする。

ユーザーの真の欲求: PDF をきれいに描画したいのではなく、PDF の構成を理解したい。
ただし「クリックした表示要素から、その元の object に辿れる」体験は必須。

## 設計の3つの柱

### 1. Lossless Layer + Explanation Layer の分離

すべての解析ノードは 3 段階の表現を持つ。

- **Raw**: PDF の生バイト・トークン・byte range
- **Decoded**: filter 展開後・型解決後の構造
- **Explained**: 人間向け説明（Human / Technical / Raw の 3 段階に分割表示）

UI から Explained → Decoded → Raw に **必ず辿れること（provenance を切らない）**。
これが守れない設計は受け入れない。詳細は `lossless-ir-design` スキル参照。

### 2. 複数 View を並立させる

PDF に単一の「セクション階層」は存在しないため、UI で以下を切替可能にする。

- File Structure View — header / body / xref / trailer / incremental update
- COS Object View — Catalog / Pages / Resources / Fonts / XObjects / ...
- Page Content View — content stream を operator 単位
- Logical Structure View — StructTreeRoot / tagged PDF
- Visual View — 実描画にクリック可能 overlay

### 3. Frontend-only

依存サーバは置かない。Browser + Web Worker（+ Phase 4 以降 optional WASM）で完結。
ユーザーは PDF をアップロードしない。ブラウザ内で全処理。

## 技術選定

| Layer | 採用 | 備考 |
|---|---|---|
| Render | PDF.js | 描画とサニティ参照のみ。解析には使わない |
| Parser | 自前 TypeScript (Worker) | content stream tokenizer 含む |
| 重い処理 | Web Worker | UI スレッドを絶対にブロックしない |
| (optional) | Rust + wasm-bindgen | Phase 4 以降、必要が確認できたら |
| UI | React + TypeScript | virtualized tree, SVG overlay |
| ストレージ | OPFS / IndexedDB / Blob URL | アップロード不要 |

## 依存最小化方針

PDF.js は必須として認める。それ以外の重い依存は導入前に必ず代替検討する。

- **状態管理**: まず React の state + Context。Zustand 等は計測してから
- **ツリー UI**: 仮想化が必要になるまで素朴な実装
- **アイコン**: SVG 直書きで足りるなら追加しない
- **スタイル**: CSS Modules または素の CSS
- **ユーティリティ集**: lodash 等は禁止。標準で足りる
- **WASM**: Phase 4 以降。最初は不要

新規依存を追加する PR では「なぜ自前で書けないか」を `docs/DECISIONS.md` に ADR として
追記すること。これが書けない依存は入れない。

## 必読ドキュメント（順序）

実装に着手する前に、最低でも 1〜3 を読むこと。

1. `docs/ARCHITECTURE.md` — レイヤー分離、データフロー、Worker 分割
2. `docs/DATA_MODEL.md` — IR 型定義（Single Source of Truth）
3. `docs/UI_SPEC.md` — 画面・インタラクション仕様
4. `docs/ROADMAP.md` — フェーズと DoD
5. `docs/TASKS.md` — 具体タスクリスト
6. `docs/DECISIONS.md` — 設計判断ログ（ADR）

## 必須スキル

このプロジェクト固有スキル（`.claude/skills/` 配下）:

**設計・実装系**
- `binary-parser-design` — PDF tokenizer/parser を書く前に必ず参照
- `devtools-ui-patterns` — 画面・インタラクション設計時
- `web-worker-orchestration` — Worker 越境設計時
- `lossless-ir-design` — IR 型を増やす・変更する時
- `wasm-integration` — Phase 4 以降、WASM 検討時のみ

**UI 美意識系**（量産 SaaS にしないために必須）
- `interface-craft` — UI 新規設計・トークン定義時（Refactoring UI / Linear / Rauno）
- `devtools-aesthetic` — 本プロジェクトのほぼ全画面で参照（情報密度・パネル設計）
- `motion-restraint` — アニメーション追加時（Emil Kowalski 流の抑制）
- `anti-ai-ui` — **UI 実装後・PR 前の必須レビュー**（12 の "AI tell" を駆逐）

UI 系スキルの適用フロー:

1. 設計時: `interface-craft` + `devtools-aesthetic` で骨格を作る
2. 実装中に動きを足す時: `motion-restraint` で抑制
3. 実装後（必須）: `anti-ai-ui` のチェックリストを通す

グローバル CLAUDE.md 由来（必ず適用）:

- `coding-principles`, `testing-principles`, `typescript-best-practices`
- UI 横断: `ui-design-craft`
- 着手前: `tdd`（仕様駆動でテスト先行）
- 実装後: `cleanup`, `small-refactoring`, `self-review`
- コミット前: `commit-granularity`
- PR: `pr-description`（必須）
- 設計レビュー: `codex-review-design`, `codex-review-readability`

## 開発フロー

1. 着手前に `docs/TASKS.md` の該当項目を確認・必要なら細分化
2. IR を変更するときは先に `docs/DATA_MODEL.md` を更新
3. 設計判断が伴う場合は `docs/DECISIONS.md` に ADR を追加
4. TDD: 仕様に対するテストを先に書く
5. 実装 → `cleanup` → `self-review` → `commit-granularity` → コミット
6. PR は `pr-description` スキル必須

## セキュリティ

入力 PDF はマルウェア相当のリスクを持つ。以下は **絶対に行わない**。

- PDF 内 JavaScript Actions の実行
- 外部 URL の自動 fetch
- Embedded files の自動展開
- フォントファイルの OS 登録

加えて以下に注意。

- 巨大 PDF（500MB+）想定。eager に全部読まない（lazy stream decoding）
- 壊れた PDF が来ても落ちない。warning として可視化する
- decompression bomb 対策（展開後サイズ上限、CPU 時間上限）

## 注意

- 描画の正確性は PDF.js に委ねる。自前 parser は **構造解析専用**
- PDF.js の `getOperatorList()` は PDF.js 用に変換済みの命令列。raw content stream
  ではない。両者を混同しないこと（UI 上で別タブにする）
- `getTextContent()` は表示には便利だが空白置換等があり raw 解析には使わない
