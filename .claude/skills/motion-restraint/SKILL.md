---
name: motion-restraint
description: Emil Kowalski（Linear / Vercel、animations.dev / Sonner / Vaul 作者）の "Great Animations" 原則に基づく、抑制された Web アニメーション設計。timing / easing / 何を animate するか / 何を animate しないか / interruptibility / accessibility / DevTools 系 UI での適用方法を扱う。トリガー: アニメーション追加、ホバー / 遷移実装、Framer Motion / Motion / CSS transition の設計、UI が「動きすぎ」と感じたとき。
---

# Motion Restraint — Emil Kowalski 流の抑制された動き

過剰な動きは UI を遅く、子供っぽく、AI 的に見せる。
このスキルは「**動かす理由がある動きだけを、最小限の時間で**」設計するための原則。

主出典: Emil Kowalski, "Great Animations" (emilkowal.ski) / animations.dev。
補強: Rauno Freiberg, Apple HIG, WCAG 2.1 (prefers-reduced-motion)。

## 中心命題

> Animations should enrich the information on the page.
> If they don't, they shouldn't exist.
> — Emil Kowalski

「かっこいいから」「Framer Motion が入ってるから」で動かさない。
**情報を伝えるためにこの動きが必要か** を毎回問う。

## Timing（持続時間）

| 種類 | 推奨時間 |
|---|---|
| Hover / focus / press の応答 | 60-120ms |
| Tooltip / popover 出現 | 80-150ms |
| Modal / Dialog 出現 | 150-250ms |
| Page transition | 200-300ms |
| **絶対上限** | **300ms** |

300ms を超える動きはほぼ間違い。「重い」「もたつく」と感じる前に終わらせる。
**Fast animations improve perceived performance**（Emil）— 速い動きは「速いアプリ」と
体感される。

## Easing

| 用途 | easing |
|---|---|
| 既定（ほぼすべて） | `ease-out` |
| 出現 | `ease-out` |
| 消失 | `ease-in` |
| 移動・連続 | `ease-in-out` |
| Spring 系 | 使うなら **damping 高め・oscillation なし** |

**`ease-out` は最初速く後でゆっくり** — 反応が速く感じる。
**Bounce / elastic / overshoot は禁忌**（`anti-ai-ui` 参照）。

実用 cubic-bezier:

```css
/* ease-out 強め (Linear 風) */
transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1);

/* ease-out 標準 */
cubic-bezier(0.25, 0.1, 0.25, 1);

/* ease-in-out 控えめ */
cubic-bezier(0.4, 0, 0.2, 1);
```

## 何を animate するか

**Transform と Opacity のみが原則**。これらは composite だけ走る = 60fps を保てる。

```css
/* ✅ */
transform: translateY(-4px) scale(1.02);
opacity: 0.8;

/* ❌ — レイアウトが走るので 60fps が出ない */
margin-top: -4px;
width: 110%;
top: 4px;          /* position 系も layout を走らせる */
```

例外: `clip-path`, `filter`（backdrop-filter は重い）。

### 高頻度な操作は animate しない

> Never animate keyboard-initiated actions. Users repeat them hundreds of times daily.
> — Emil

- 検索 hit のジャンプ
- ツリーの ↑↓ ナビゲーション
- タブ切替を `cmd+1..9` で行う場合
- フォーカス移動

これらは **瞬間遷移**。動きを入れると即座に「もっさり」体感になる。

## Interruptibility（中断可能性）

ユーザーが途中で操作したらアニメーションは **即時に新状態に向き直す**。

```css
/* CSS transition は自然と中断可能 */
.menu { opacity: 0; transition: opacity 120ms ease-out; }
.menu[data-open] { opacity: 1; }
```

JS で書くなら framer-motion / motion-one の補間が始点を「現在値」にする実装を選ぶ。
**「始点固定で再生」してはいけない**（途中で開閉を繰り返した時にカクつく）。

## Accessibility

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

これは **必ず** 入れる。デフォルトを「動きあり」、reduced motion を「動きなし」にする。

その上で、reduced motion でも **fade（opacity の変化）は許される** ことが多い。完全に
無くすかは設計判断。

## どこで動かすか（DevTools 系 UI 向けの判断）

pnake のようなインスペクタ系では **動きを大幅に減らす**。以下のみ許可:

| 動き | 用途 | 時間 |
|---|---|---|
| Hover の opacity 微変化 | feedback | 80ms |
| Tooltip 出現 | feedback | 80-120ms |
| Modal / popover の opacity + scale 0.98→1 | 出現 | 150ms |
| Tree expand の height（または不要なら省略） | 構造変化の暗示 | 120ms |
| Drawer の slide | 出現 | 200ms |
| `scroll-into-view` で選択 ID にジャンプ | 文脈維持 | 80-120ms |

禁止:

- ツリーノードの選択色 transition（即時で十分）
- ペイン境界 resize の慣性
- データロード後の stagger アニメーション
- 数値カウントアップ

## Motion Choreography（複数要素の振付）

複数の要素が同時に動くなら、**「主従関係」** を持たせる:

- 主役 = 大きく速く（150ms）
- 従属 = 小さく遅れて（30-60ms の delay + 100ms）

全要素同時に動くと「機械的」、全要素バラバラに動くと「散漫」。
3 要素以上は普通 stagger 不要 — むしろ瞬時に出して情報を見せる方が DevTools 向け。

## State Transitions

ボタン押下の feedback は **動きではなく "scale" の即時反応**:

```css
button {
  transition: transform 100ms ease-out;
}
button:active {
  transform: scale(0.97);
}
```

- hover: opacity / background の微変化
- focus: ring の即時表示（**transition なし**。アクセシビリティ的に重要）
- active: scale 微小変化

## Spring の扱い

Spring は乱用厳禁だが、使うなら設定基準:

```ts
// Vaul / Sonner（Emil 製）の感じに近い
{ type: "spring", stiffness: 400, damping: 35, mass: 1 }
// 振動しない、素早く落ち着く設定
```

stiffness < 200 や damping < 20 は overshoot が目立つ。**Linear / Notion / Vercel が
spring を使うときの感じ**を真似る。

## 計測

- DevTools の Performance パネルで 60fps を確認
- 重い backdrop-filter / box-shadow を transition していないか
- 同時実行アニメーション数 < 5 が目安

## 自己レビュー

- [ ] 動かしている理由を 1 文で言えるか
- [ ] 持続時間は 300ms 以下か
- [ ] easing は ease-out 系か
- [ ] animate しているのは transform / opacity だけか
- [ ] 高頻度操作 (keyboard nav) に動きを入れていないか
- [ ] 中断可能か（hover を on/off 連打した時にカクつかない）
- [ ] `prefers-reduced-motion` を尊重しているか
- [ ] `anti-ai-ui` の bounce / elastic に該当していないか

## 関連スキル

- 避ける動き: `anti-ai-ui`（bounce / elastic）
- 設計の上位: `interface-craft`
- DevTools 向け: `devtools-aesthetic`
- 包括: `ui-design-craft`
