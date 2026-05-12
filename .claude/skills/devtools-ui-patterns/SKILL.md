---
name: devtools-ui-patterns
description: Chrome DevTools 風のインスペクタ UI（ツリー / プレビュー / 詳細 / 下部ドロワー）を設計・実装するときに使う。クロスペイン選択同期、Raw / Decoded / Explained の階層表示、仮想化リスト、click-to-jump、bottom drawer の標準パターンを提供する。トリガー: inspector / DevTools / 解析ツール / debugger UI / 構造ビューアの実装やレビュー時。
---

# DevTools UI Patterns

開発者向けインスペクタ UI を作るときの設計パターン集。
対象は「複雑な構造化データを掘り下げて見るためのツール」全般。

## 中心原則

### 1. 単一の選択 ID で全ペインを同期する

DevTools 系 UI の本質は **「同じものを別の角度から見る」**。
それを実現する最も簡潔な方法が「グローバルな `selectedNodeId`」。

```ts
type AppState = {
  selectedNodeId?: string;
  selectionOrigin: "tree" | "preview" | "trace" | "detail" | "search";
};
```

- ID は **安定キー**（再描画・再解析でも同じ）
- すべてのクリック可能要素は ID を持つ
- 選択変更は **1 つの reducer / setter** で行う（複数経路で更新するとバグる）
- `selectionOrigin` を持つと、自分が原因の選択ではスクロールしない等の挙動を作れる

### 2. Raw / Decoded / Explained の 3 段階表示

これは PDF 特有ではなく、すべての DevTools に共通する強力なパターン。

| 段階 | 何を見せる | 例 |
|---|---|---|
| Raw | 元データそのまま | 生バイト、トークン、生 JSON |
| Decoded | パース・型解決後 | 構造化された dict、配列 |
| Explained | 人間向け説明 | 「これは画像です（1024x768, JPEG）」 |

UI 上では **タブで切り替え** にする（同時表示すると圧倒される）。
ただし「ジャンプ」は提供する: Explained で見ていて raw に飛びたい時のリンク。

### 3. Click-to-Jump（双方向リンク）

「描画上の要素 → 元 object」「object → 別の object」「警告 → 該当 byte range」など
すべてのリンクは双方向にする。

実装パターン:

```ts
type Link = {
  fromId: string;
  toId: string;
  kind: "reference" | "render-source" | "warning-target";
};

// 双方向 index を build しておく
const linksByFrom = new Map<string, Link[]>();
const linksByTo = new Map<string, Link[]>();
```

UI では「Related」セクションで他ノードへのリンクを一覧表示。

## レイアウト

### 標準三分割

```
┌──────────────┬─────────────────┬────────────────┐
│ Tree         │ Preview         │ Detail         │
│ (左, 20-30%) │ (中央, 40-50%)  │ (右, 20-30%)   │
├──────────────┴─────────────────┴────────────────┤
│ Bottom Drawer (折りたたみ可)                     │
└─────────────────────────────────────────────────┘
```

各ペインの境界は **ドラッグでリサイズ可能**。CSS Grid + pointer events で 100 行未満で書ける。
ライブラリ（react-split-pane 等）を導入する前に必ず自前検討。

### Tree Panel

- 仮想化必須（1000+ ノードを想定）
- 段差はインデント幅で表現、border は引かない
- 各行: `[icon] [primary text] [type chip]`
- icon は kind 別、type chip は短い英字（"Stream" "Image" "Font" 等）
- 展開状態は ID ベースで保持（DOM ではなく state）

仮想化は素朴に：

```ts
function VirtualList({ items, rowHeight, viewport }: Props) {
  const start = Math.floor(scrollTop / rowHeight);
  const end = Math.ceil((scrollTop + viewport) / rowHeight);
  const visible = items.slice(start, end + 1);
  return (
    <div style={{ height: items.length * rowHeight, position: "relative" }}>
      {visible.map((item, i) => (
        <div style={{ position: "absolute", top: (start + i) * rowHeight }}>
          {render(item)}
        </div>
      ))}
    </div>
  );
}
```

これで 10000 ノードが滑らかに動く。react-arborist を入れる前に試す。

### Preview Panel

中央は「実物」を出す場所。

- canvas / image / 3D / map など、形式に応じて
- 上に **SVG overlay** で選択可能領域を表現
- canvas と overlay は **同じ座標系に揃える**

overlay は SVG を勧める。理由:

- pointer events が要素単位で動く（hit-test 自前不要）
- 拡大縮小に強い（vector）
- CSS で hover を書ける
- accessible（role="button"）

### Detail Panel

- タブ: Human / Technical / Raw
- 各タブは縦スクロール
- 「Related」セクションは常時表示（タブの上または下）

### Bottom Drawer

- デフォルトは閉じる（画面を広く使う）
- `b` キーで開閉
- タブ: 文脈に応じて変わる（選択 kind 依存）

## インタラクション

### 選択

- クリック: 単一選択
- shift / cmd で複数選択は **基本やらない**（DevTools の選択モデルは単一が標準）
- 複数選択が欲しくなった = 設計が間違っている可能性が高い（フィルタや「全部を見る view」を作るべき）

### ナビゲーション

| 動作 | キー |
|---|---|
| Tree 上下 | ↑ ↓ |
| 展開 / 折畳 | ← → |
| view mode | キーバインド（プロジェクト固有） |
| 検索 | / |
| 戻る / 進む | cmd+[ / cmd+] |

### 検索

- グローバル検索: 全ノードの hint / type / 値文字列を対象
- 結果はサイドポップアップ（フルスクリーン化しない）
- Enter で次ヒット、shift+Enter で前ヒット
- 検索結果は ID リスト。クリックで通常の選択フロー

## アクセシビリティ

- Tree は `role="tree"` / `treeitem` / `aria-expanded` / `aria-level`
- フォーカスリングを消さない
- 色だけに依存しない（chip に文字、icon に alt）
- キーボードだけで全機能にアクセスできること

## パフォーマンス

| 計測対象 | 目標 |
|---|---|
| 初期描画 | < 100ms（10000 ノードでも） |
| 選択切替 | < 50ms |
| ツリー展開 | < 16ms |
| 検索 | < 200ms |

落とし穴:

- 全ノードに onClick を bind → メモリと再レンダリングが死ぬ。delegation で 1 つに
- 仮想化なしの flat 一覧 → 数千で固まる
- 選択変更時に全ペインを丸ごと再レンダリング → memo で防ぐ
- inline style での座標計算 → CSS variable に逃がす

## 状態管理

DevTools 系は state がそこまで複雑にならない。最初は **React の `useState` + `useReducer` + Context** で十分。Redux / Zustand / Jotai は **必要になってから**。

Context は 1 つに詰め込まず、purpose 別に分ける:

- `SelectionContext`（selectedNodeId, origin）
- `ViewContext`（current view mode, expanded set）
- `DataContext`（IR, loading state）

これにより「選択変更で全部再レンダリング」を避けやすい。

## アンチパターン

- ペインの境界を固定（リサイズできない）
- ツリーと preview の選択が連動しない
- Raw / Decoded を混在表示
- 双方向リンクなし（「ここから来た」が分からない）
- 検索で結果リストを出さず一つずつジャンプ
- 選択中ノードが視覚的に分かりにくい（色だけ・薄い）
- bottom drawer がデフォルトで開いている（画面を圧迫）

## 自己レビュー

- [ ] 任意のペインで選択した時、他 3 ペインが同期するか
- [ ] 双方向リンクが効くか
- [ ] 10000 ノードでも滑らかか
- [ ] キーボードだけで使えるか
- [ ] アクセシビリティ属性が付いているか
- [ ] 「戻る」が動くか
