---
name: devtools-aesthetic
description: Chrome DevTools / VS Code / Linear / Raycast / Arc inspector / Figma 系の「技術系・情報密度高め・キーボード重視」UI を作るための具体パターン集。情報密度 / 表 / ツリー / プロパティパネル / タブ / ツールバー / 配色 / typography を扱う。pnake のような構造インスペクタや、コード・ログ・データを高密度で見せる画面で必ず参照する。トリガー: dev tool / inspector / debugger / structural viewer / dense data grid の設計・実装。
---

# DevTools Aesthetic — 情報密度の高い技術系 UI の作法

「広い余白に少しの情報」ではなく「**狭い余白に最大限の情報** を、それでも疲れずに
見続けられる」UI を作るためのスキル。

主出典:
- Evil Martians "5 essential design patterns for dev tool UIs" / "Devs in mind"
- Tufte の data-ink ratio
- Chrome DevTools / VS Code / Linear / Raycast / Arc / Figma の実装研究

## 思想の差

| 一般 SaaS / Landing | DevTools 系 |
|---|---|
| 余白多め、視線誘導の余裕 | 余白最小、情報を一覧 |
| Hero + Card のリズム | パネル分割で並列表示 |
| カラフルな accent | グレースケール基調 + 機能色 |
| マウス前提 | キーボード前提 |
| 装飾的 icon | 機能的 icon、または text label |
| 16px 本文 | 12-13px 本文 + tabular numbers |

これらは **真逆の方向性**。混ぜると中途半端になる。pnake のような inspector は
**完全に DevTools 側に振り切る**。

## 5 つの基本パターン

Evil Martians の整理を、pnake の文脈で具体化したもの。

### 1. Tabs

- アクティブタブは **明確に区別**（fill color, underline, または両方）
- 非アクティブは 60% opacity 程度
- close ボタンは **アクティブタブにのみ表示**（VS Code 流。視覚ノイズ削減）
- タブ多数時は scroll、ピン留めで永続化
- キーボードショートカット必須（`cmd+1..9` で N 番目、`cmd+W` で close）

```
┌────────────┬─────────────┬────────────┐
│ Active  ×  │ inactive    │ inactive   │ ← close は active のみ
└────────────┴─────────────┴────────────┘
```

### 2. Toolbars

- 高さは **32-40px**（ボタンの hit area = 24-32px、余白 4-8px）
- 関連アクションを border / spacer で **3-5 グループ** に分ける
- icon-only ボタンは tooltip 必須
- 主要アクション + ショートカット表示（`Save ⌘S`）
- 状態に応じた disable（grayed、tooltip で理由提示）

### 3. Navigation Sidebar / Tree

- 1 行 **24-28px** 高さ（標準より低い）
- インデントは **12-16px** 単位
- 展開アイコン（chevron）は左、ノードアイコンは中、ラベルは右
- hover で背景の極薄ハイライト（rgba(white, 0.04) 等）
- 選択ノードは **明確なハイライト** + 左端 2-3px の accent bar
- フォーカス時のみキーボードハイライト（dotted ring 等）

```
▸ obj:1:0  Catalog
▾ obj:2:0  Pages
  ▸ obj:3:0  Page #1
  ▸ obj:4:0  Page #2
```

### 4. Properties Panel

- **label-value** ペアの配置に統一
- label 幅 = 固定（120px 等）/ value 幅 = 残り
- 編集可能なものは **inline editing**（クリックで入力モードに）
- value の型に応じた control:
  - bool → switch / checkbox
  - enum → dropdown
  - color → swatch + hex input
  - number → input + (optional) slider
- 単位は value の右に薄字で（`12.5 pt`）
- 「未設定」と「0」を視覚的に区別（placeholder color の差）

### 5. Tables

- header: **bold + 12px + uppercase 微妙**、罫線控えめ
- body: **tabular-nums + monospace（数値列）**, 行高 28-32px
- **sticky header** 必須
- **行 hover** のハイライトは即時（transition なし）
- 選択行は accent bar + 背景の極薄色
- 並び替え可能列は header クリックで sort + 三角インジケータ
- 大量行は **仮想化**（10000+ 想定）

## 情報密度の設計

### Tufte 原則: Data-Ink Ratio

> 全 ink のうち、データを表現するために使われている割合を最大化せよ。

具体に落とす:

- 罫線・背景色・shadow・装飾を **減らす**
- 重要でない情報は **opacity 60%** に
- 同じ情報を 2 度書かない（label + tooltip の重複等）
- icon と text label を両方出すなら、どちらかに意味付けがあること

### Font Size

| 役割 | px |
|---|---|
| Body / ツリーラベル | 12-13 |
| Section title | 13-14 (semibold) |
| Toolbar label | 11-12 |
| Code / Hex / Raw | 12-13 (monospace) |
| Hover tooltip | 11-12 |

「ブラウザ標準 16px」は **app UI には大きすぎる**。
ただし `text-size-adjust: 100%` と最小サイズの ad-hoc なテストは必須。

### Line Height

- 本文 1.5 は **広すぎる**。1.3-1.4 を基準
- Tree / Table の行: **1.2-1.3**
- Tooltip / chip 等の単行: 1.1-1.2

### Tabular Numbers

数値が並ぶ場所では `font-variant-numeric: tabular-nums`（または OpenType feature `tnum`）。
これで桁が揃って読みやすくなる。

```css
.numeric, td.num, .offset, .byte-range {
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono);
}
```

## 配色

### 基本: グレースケール + 機能色

- グレー 10-12 段階を主軸
- accent は 1 色（青系が標準）
- 機能色: success（緑）/ warning（黄）/ danger（赤）/ info（青）
- ジャンル分類色（PDF の kind 別）は **彩度低め + hue を散らす**。原色は使わない

例（Linear / VS Code 系 dark）:

```css
--bg-0: #0e0e10;       /* 一番奥 */
--bg-1: #15161a;       /* panel */
--bg-2: #1c1d22;       /* card / row */
--bg-3: #24262c;       /* hover */
--fg-0: #e6e8eb;       /* primary text */
--fg-1: #b3b6bc;       /* secondary */
--fg-2: #74787f;       /* tertiary / placeholder */
--accent: #4493f8;     /* selection */
--hairline: rgba(255,255,255,0.06);
```

### kind 別タグの色

色だけに意味を載せない。**text label + 控えめな色** の組み合わせ。

```
[ Stream ]  → 紫みの灰
[ Image  ]  → 緑みの灰
[ Font   ]  → 青みの灰
[ Text   ]  → 黄みの灰
[ Path   ]  → 橙みの灰
```

濃度は背景と読みやすい程度に AA 以上を確保。

## レイアウト

### Resizable Panes

DevTools 系の基本要件。実装パターン:

```tsx
// CSS Grid + pointer events で 100 行未満
<div style={{ gridTemplateColumns: `${leftW}px 4px 1fr 4px ${rightW}px` }}>
  <Tree />
  <Splitter onDrag={d => setLeftW(w => w + d)} />
  <Render />
  <Splitter onDrag={d => setRightW(w => w - d)} />
  <Detail />
</div>
```

- ペイン境界は **4-6px**（hover で 6-8px に拡大）
- カーソルは `col-resize` / `row-resize`
- ダブルクリックで **デフォルト幅にリセット**
- 値は localStorage に保存
- 最小幅・最大幅を制約

### Bottom Drawer

折り畳み可能、デフォルト畳む。`b` キーで開閉。高さは drag で調整。

### Status Bar（任意）

最下部 1 行（22-24px）で:
- 現在のページ番号 / 総ページ数
- ファイルサイズ
- 警告数
- 解析状況

## キーボード優先

DevTools 系は **マウスより先にキーボード**を設計する。

| 要件 | 実装 |
|---|---|
| 全機能にキーボードアクセス | Tab で巡回、Enter で実行 |
| ショートカット可視化 | tooltip と menu に `⌘K` 等を表示 |
| Command palette | `⌘K` で全機能検索（Raycast / VS Code 風） |
| Focus ring | 隠さない、ただし mouse focus とは区別 |
| Vim-like nav (任意) | `j/k` で上下、`gg/G` で先頭末尾 |

`:focus-visible` を使えば mouse focus では ring を出さず、keyboard focus で出せる。

## アクセシビリティ

密度を上げる際の注意:

- 12px はギリギリ。**11px 以下は使わない**
- 色だけに依存しない（icon / label / pattern を併用）
- focus ring は明確に
- `role="tree" / treeitem / aria-expanded / aria-level` を正しく付ける
- table は `role="grid"` + `aria-rowindex` / `aria-colindex`
- screen reader 用に意味の通る label を持たせる

## 命名規則

スタイルやトークンの命名で雰囲気が決まる:

```
❌ primary / secondary / muted     ← SaaS 的
✅ fg-default / fg-subtle / fg-faint / fg-disabled

❌ bg-light / bg-dark              ← 抽象的
✅ surface-canvas / surface-panel / surface-overlay
```

## 自己レビュー

- [ ] 1 行高さは 28px 以下になっているか
- [ ] 本文は 12-13px か
- [ ] tabular-nums を数値カラムに適用したか
- [ ] panes は resize / restore できるか
- [ ] keyboard で全機能アクセスできるか
- [ ] 罫線・shadow を **減らした** か
- [ ] kind 別の色は彩度を抑えたか
- [ ] focus visible が機能しているか
- [ ] `motion-restraint` の禁忌に触れていないか

## 関連スキル

- 動き: `motion-restraint`
- 設計の上位: `interface-craft`
- 避ける: `anti-ai-ui`
- 包括: `ui-design-craft`
