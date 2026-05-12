---
name: anti-ai-ui
description: AI 生成 UI が「いかにも AI 製」に見える 12 のテルテイル・サイン（purple-blue gradient, glassmorphism, card-in-card, gradient text on numbers 等）を列挙し、それぞれの具体的な代替を提供する。UI 実装後・レビュー時に必ずこのチェックリストを通すこと。トリガー: UI を生成・実装・レビューしたとき、画面が「ありがち / 量産 SaaS っぽい / どこかで見た」と感じたとき、ランディング・ダッシュボード・管理画面・コンポーネント設計をしたとき。
---

# Anti-AI UI — generic な見た目を駆逐するための negative constraints

AI（人間 designer も含む）が無意識に量産する「見たことある」UI のテルテイル・サインと
代替案。**生成後の必須レビューチェックリスト**として使う。

> LLM は「やってほしいこと」だけ指示すると memorized pattern に引っ張られる。
> **やってはいけないこと** を明示する方が効く。これはそのための negative constraint pack。

## Tell Sign Catalog

各項目: ❌ 避ける / ✅ 代替案 / 🔍 検知の仕方。

### 1. Purple → Blue / Cyan のグラデーション

❌ `from-purple-500 to-blue-500`、`from-violet-600 via-fuchsia-500 to-cyan-400`。

✅ 単色 + ニュートラル系で 95% 構成し、accent は 1 色だけ持つ。グラデーションを
どうしても使うなら **同系色の極めて近いトーン同士**（例: `#1a1a1a` → `#0f0f0f`）。

🔍 hue が大きく動くグラデーションを探す（特に 270deg→210deg）。

### 2. 装飾的 Glassmorphism

❌ `backdrop-blur-xl bg-white/10 border border-white/20` をカード全部に適用。

✅ blur は **機能的に必要な箇所** にだけ使う（背景上に浮かぶフローティング UI、
モーダル背景、コンテキストメニュー）。flat surface に解像感ある border / hairline
の方が情報密度が高い UI で有効。

🔍 `backdrop-blur` が 3 個以上ヒットしたら見直す。

### 3. Card-in-Card のネスト

❌ `<Card><CardHeader><Card>...</Card></CardHeader></Card>` のような階層構造。
elevation が累積して情報の重要度が崩壊する。

✅ 1 階層に flatten する。境界が必要なら **hairline border**（1px, 不透明度高め）か
**spacing** で区切る。box-shadow と border の両方を使わない。

🔍 入れ子の Card / Surface / Panel を grep。

### 4. Hero メトリクス常套句

❌ 巨大数字 + 小さいラベル + ↑12% の緑 chip + 色違いグラデ背景 を 4 カラム並べる。

✅ 数字を出すなら **比較・トレンド・絶対値の単位** がわかる文脈と一緒に出す。
sparkline、前期との対比、目標までの距離。数値だけ巨大化しない。

🔍 KPI card / Stat card / Metric card と命名されたコンポーネントをすべて疑う。

### 5. 数字や見出しへの gradient text

❌ `bg-gradient-to-r from-pink-500 to-violet-500 bg-clip-text text-transparent` の
見出し / 数字。

✅ 通常色 + weight / size で hierarchy を作る。gradient はロゴ・装飾の極小範囲のみ。
数値は legibility が最優先。

🔍 `bg-clip-text` の出現箇所をすべて見直す。

### 6. デフォルトフォント任せ

❌ Inter / Roboto / Open Sans / Arial のままシステム任せ。これだけで「無思考」と
読み取られる。

✅ プロジェクトの性格に合うものを 1 つ決める。例:
- DevTools 系: `Berkeley Mono`, `JetBrains Mono`, `IBM Plex Mono` を UI でも積極使用
- ドキュメント系: `IBM Plex Sans`, `Söhne`, `Geist`, `Suisse Int'l`
- ライティング系: `Inter Tight` + `Tiempos Text`
- 数字: tabular figures を有効化（`font-feature-settings: "tnum"`）

明確な意図がない場合は `system-ui` を選ぶ（Inter より無印で潔い）。

🔍 `font-family: Inter` のままで他のテーマ性が一切ないか確認。

### 7. ソフトシャドウの過剰投入

❌ `shadow-lg` / `shadow-2xl` をすべての要素に。`drop-shadow-md` を浮遊させる装飾用途。

✅ shadow は **本当に浮いている要素** にだけ。popover / modal / tooltip / dropdown。
それ以外は **border** か **subtle background contrast** で区切る。

🔍 shadow が 3 種類以上の elevation で散らばっていたら整理。

### 8. アイコン詰め込み

❌ ボタンに必ず icon、見出しの横にも icon、empty state にも icon、ラベルにも icon。

✅ icon は **意味の差別化に必要なとき** だけ。ボタンに icon を付けるルールにする
なら全 button、付けないなら全 button に統一。揺れない。

🔍 1 画面で 15 以上の icon があれば過剰のサイン。

### 9. Bounce / Elastic easing

❌ `cubic-bezier(.34,1.56,.64,1)` のような overshoot を要素遷移に使う。
spring の oscillation が止まらないアニメーション。

✅ `ease-out` 系 + < 300ms（`motion-restraint` スキル参照）。
overshoot は遊び心が許される場所（onboarding success、empty state）のみ。

🔍 framer-motion の `spring` で `stiffness` 低め / `damping` 低めの設定を探す。

### 10. 万能 Avatar / 適当 illustration

❌ pravatar / unsplash の顔写真をテストデータに散りばめ、それが残る。
unDraw 系の似たり寄ったり illustration を空状態に。

✅ avatar はイニシャル + 単色 background から始める。illustration は本当に必要なら
プロジェクト固有の方向性で **1 種類** だけ。

🔍 ダミーデータと本番データの境界。avatar 周りに `pravatar.cc` / `picsum.photos` 残りなし。

### 11. すべて中央寄せ・カラム制限

❌ landing page じゃないのに `max-w-3xl mx-auto` を全画面に。狭いレールに沿った
情報量で「広い画面の意味がない」状態に。

✅ アプリ UI は **画面いっぱい使う**。情報密度は意図的に上げる
（`devtools-aesthetic` スキル参照）。空白は意味ある場所に。

🔍 dashboard / app 画面で `max-w-*xl mx-auto` を multiple panel に適用していないか。

### 12. 同寸グリッドの果てしない繰り返し

❌ 4 カラム × N 行の grid に同じ card を並べ続ける。

✅ 情報の重要度・性質で **size / treatment を変える**（重要なものは大きく・上に）。
表が適切なら表に。grid を grid のために使わない。

🔍 `grid-cols-3 md:grid-cols-4` で 8 個以上の同形要素を出している箇所。

## 構造上の AI tells

要素レベルだけでなく、構造・命名にも tell が出る。

| パターン | 何が問題か | 代替 |
|---|---|---|
| `Hero / Features / CTA / Footer` の組み合わせ | landing page 型を app に流用 | 各画面で必要な構造を独立に設計 |
| すべての section に `<h2>` + lead 1 行 + grid | 機械的すぎる | section ごとに密度・形式を変える |
| 「ありがちな見出し」 (Beautiful. Powerful. Simple.) | 中身ゼロ | プロジェクト固有の主張に置き換え |
| すべての button が同じ size と shape | hierarchy がない | primary / secondary / tertiary を size + treatment で差別化 |

## レビューフロー（実装後）

1. このカタログを通しで読む（30 秒）
2. 該当した tell sign を **すべてリストアップ**
3. それぞれ「機能上必要か / 装飾か」を判定
4. 装飾なら削除 or 代替に置換
5. 機能上必要な場合は **理由をコメントまたは PR 説明に明記**

説明できない見た目は残さない。これが基本。

## 強い負の指示テンプレ

UI 生成を依頼する際の prompt に貼る:

```
Avoid:
- purple/blue or violet/cyan gradients anywhere
- gradient text on numbers or headings
- glassmorphism / backdrop-blur except on overlays
- nested cards or surfaces
- generic stat-card grids (large number + small label + green chip)
- soft shadows on flat layouts
- bounce or elastic easing
- icons on every button or heading
- max-width content with massive empty margins on app screens
- generic copy ("Beautiful. Fast. Simple.")
Prefer:
- hairline borders over shadows
- size / weight / spacing for hierarchy
- a single accent color
- tabular numbers
- typography you actually chose (not Inter by default)
```

## 関連スキル

- 機能上の質を高める: `interface-craft`
- 動きの抑制: `motion-restraint`
- 密度・パネル設計: `devtools-aesthetic`
- 包括ガイド: グローバルの `ui-design-craft`
