# UI Specification

画面構成・状態・主要インタラクションをまとめる。

UI を書く前に、次のスキルを読んでおくと迷いが減る。

- `devtools-ui-patterns`: 三分割、選択同期、raw / decoded / explained といった DevTools 系の構造原則。
- `devtools-aesthetic`: 情報密度、タイポ、色、パネル設計の具体パターン。
- `interface-craft`: Refactoring UI、Linear、Rauno 流の craft 寄り。
- `motion-restraint`: アニメーションの抑制方針 (Emil Kowalski 系)。
- `anti-ai-ui`: PR を投げる前のチェックリスト。AI 製 UI に出やすい 12 種の癖を潰す。

このドキュメントとスキル記述が食い違う場合は、スキル側を真とする。

## 全体レイアウト

```
┌───────────────────────────────────────────────────────────────────┐
│ Toolbar:  [file] [page▾] [zoom] [view-mode▾] [search] [⚠ N]      │
├──────────────┬─────────────────────────────┬──────────────────────┤
│ Tree Panel   │ Render Panel                │ Detail Panel         │
│              │                             │                      │
│ (View切替)   │ ┌─PDF canvas──────────────┐ │ [Human]              │
│              │ │                          │ │ [Technical]          │
│ ├ File       │ │  + SVG overlay           │ │ [Raw]                │
│ │  ├ Header  │ │     (clickable bboxes)   │ │                      │
│ │  ├ Body…   │ │                          │ │ - explanation        │
│ │  └ Trailer │ │                          │ │ - spec ref           │
│ ├ Objects    │ └──────────────────────────┘ │ - related            │
│ ├ Pages      │                             │ - warnings           │
│ ├ Resources  │                             │                      │
│ ├ Content    │                             │                      │
│ ├ Structure  │                             │                      │
│ └ Warnings   │                             │                      │
├──────────────┴─────────────────────────────┴──────────────────────┤
│ Bottom Drawer:                                                     │
│ [Raw bytes] [Decoded stream] [Operator trace] [Graphics state]    │
└───────────────────────────────────────────────────────────────────┘
```

主要 4 領域 + 上下のバー。3 ペイン分割は左右いずれもユーザがドラッグで調整可能。
Bottom Drawer は折りたたみ可（デフォルトは閉じる）。

## グローバル状態

main thread に置く（Worker からは隔離）。

```ts
type AppState = {
  fileId?: string;
  manifest?: PdfAnalysis;        // 軽量 manifest
  pageNumber: number;
  pageAnalysis?: PdfPageAnalysis;
  selectedNodeId?: string;       // 単一選択。複数選択は当面なし
  selectionOrigin: "tree" | "overlay" | "trace" | "detail" | "search";
  treeView: TreeViewMode;
  bottomTab: BottomTab;
  searchQuery: string;
};

type TreeViewMode =
  | "file" | "objects" | "pages" | "resources"
  | "content" | "structure" | "warnings";

type BottomTab = "raw" | "decoded" | "trace" | "graphics-state" | "closed";
```

選択 ID は **全ペインで共有**。どこから選んでも他が追従する。

## Tree Panel

### 表示モード

`treeView` で切替（toolbar の dropdown）。すべてのモードで:

- 仮想化リスト（ノード数 10000+ を想定）
- 検索: 部分一致、ヒット数表示、Enter で次ヒット
- 右クリック → context menu（Copy ID / Copy raw / Reveal in Bytes）

### モード別

| Mode | ルート | 子 |
|---|---|---|
| File | Header / Body[i] / EOF | xref entries / trailer / startxref |
| Objects | All objects sorted by `num:gen` | dict entries（recursive） |
| Pages | Pages tree | Page → Resources / Annots / Contents |
| Resources | Fonts / XObjects / ExtGState / ColorSpace | 各リソース定義 |
| Content | Pages | Operator timeline (q...Q ネスト, BT...ET ネスト) |
| Structure | StructTreeRoot | Document / Sect / H1 / P / Figure / Table |
| Warnings | severity 別 | 個別 warning（jumpable） |

### ノード描画

各行: `[icon] [hint] [type chip]` 程度の密度。
icon は kind 別の色付き。chip は `Stream/Image/Font/Text/Op...`。

## Render Panel

### 構成

- canvas 要素に PDF.js でレンダリング（参照画像）
- 上に SVG overlay
- ズーム・パン対応
- 表示オプション（toolbar）: text bboxes / image bboxes / paths / clipping / form xobjects

### Overlay

SVG 要素は `PdfVisualElement` から生成。

- `text-run` — 半透明青
- `image` — 半透明緑
- `path` — 半透明オレンジ
- `form-xobject` — 紫枠
- `clip` — 点線

クリックで該当 visual element の `sourceOperationIds[0]` を `selectedNodeId` に設定。
hover で軽くハイライト + tooltip（kind / bbox / preview）。

選択中 overlay は強調表示。逆に「Tree でクリック → overlay の対応 bbox を強調」も実装する。

### 注意

- canvas と SVG は **同じ座標系（PDF user space → CSS pixel）に揃える**
- ページ rotation を尊重
- スクロール時の重なり順は overlay > canvas

## Detail Panel

選択中ノードの 3 段階表示。タブで切替（既定: Human）。

### Human タブ

- 1〜3 文 の平易な日本語
- 関連ノードを「Related」セクションで列挙（クリックでジャンプ）
- spec ref があれば「PDF 仕様: 8.4.3 Line Width」と表示

### Technical タブ

- key=value 形式の構造化情報
- operator なら: operator, operand 一覧, category, GS 影響範囲
- object なら: type, dict entries 要約, 参照元 / 参照先

### Raw タブ

- monospace で raw bytes / token を表示
- byte range が分かるなら左端に offset
- 非 ASCII は hex 表示にトグル可
- 大きい場合は最初の N バイトのみ + 「Show full」

## Bottom Drawer

選択中ノードに応じて以下を出す。

| Tab | 表示内容 |
|---|---|
| Raw bytes | 該当 byte range（hex + ASCII）。常に有効 |
| Decoded stream | stream 持ちのノードのみ。filter 展開後の内容 |
| Operator trace | content stream 操作の時系列。current op を強調 |
| Graphics state | current op 実行前後の state 差分テーブル |

Operator trace は **Tree の Content モードと連動**（同じデータの別ビュー）。

## Selection Model

- **単一選択**。複数選択は当面なし
- `selectedNodeId` の変更で 4 ペインが同期
- `selectionOrigin` はアニメーションとフォーカス制御に使う（自分発の選択ではスクロール
  しない、他発ならスクロールして見せる）

## Toolbar

- File 名（drop で再ロード可能）
- Page navigator: `< 12 / 134 >`
- Zoom: `[-] 100% [+]` + fit-width / fit-page
- View mode dropdown（Tree Panel と連動）
- Search: グローバル検索（全ノード対象、結果は side popup）
- Warning summary: `⚠ 3 errors / 12 warnings` クリックで Warnings View

## Keyboard

| キー | 動作 |
|---|---|
| `↑ / ↓` | Tree 上下 |
| `← / →` | Tree 折畳 / 展開 |
| `Enter` | Detail / overlay にフォーカス |
| `f` | File mode |
| `o` | Objects mode |
| `p` | Pages mode |
| `c` | Content mode |
| `/` | 検索 |
| `]` / `[` | 次 / 前ページ |
| `g` then `1..9` | 段階 view 切替 |
| `b` | Bottom drawer toggle |

## 空状態 / エラー状態

- ファイル未ロード: 中央に大きい drop zone「PDF をここへ」
- 解析中: skeleton + progress bar（Worker から % 報告）
- 壊れた PDF: 上部に赤バナー「部分的に解析しました（warnings: N）」+ できる範囲を表示
- 暗号化 PDF: パスワード入力 UI（owner password はオプション）

## アクセシビリティ

- Tree は `role="tree"` / `role="treeitem"` + `aria-expanded`
- Overlay の bbox には alt-text 相当の hover info
- フォーカスリングは隠さない
- 色だけに依存しない（kind chip + テキストラベル）

## モーション

最小限。**詳細は `motion-restraint` スキル参照**。

- 選択ジャンプは 120ms の scroll-into-view（reduced-motion なら無効）
- overlay の hover は 80ms の opacity
- ツリー展開は 120ms の height（または不要なら省略）
- 上記以外のアニメーションは原則入れない
- bounce / elastic / overshoot は禁止

## 非ゴール

- PDF の編集
- ページの並べ替え・分割・結合
- OCR
- フォーム入力
- 署名検証（Phase 5 以降検討）
- 印刷プレビュー
