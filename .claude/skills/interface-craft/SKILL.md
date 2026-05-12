---
name: interface-craft
description: 著名 UI デザイナー・組織の方針（Refactoring UI [Adam Wathan / Steve Schoger]、Linear / Karri Saarinen、Rauno Freiberg の Devouring Details）から抽出した、量産品ではないインターフェースを作るためのポジティブな原則集。色・タイポグラフィ・空間・階層・craft への態度を扱う。トリガー: UI を新規設計、デザインシステムのトークン定義、コンポーネントの細部詰め、既存 UI のリファインメント時。
---

# Interface Craft — 量産品でない UI を作るためのポジティブ原則

`anti-ai-ui` が「やってはいけないこと」なら、こちらは **「やるべきこと」**。
出典は Refactoring UI（Adam Wathan / Steve Schoger）、Linear / Karri Saarinen、
Rauno Freiberg（Devouring Details / Vercel / Arc）。

## 中心の態度: Craft

> Craft is the human process of shaping something and putting a piece of yourself
> into the work. The deliberate attention put into making something excellent,
> not because someone is checking, but because it matters to the maker.
> — Karri Saarinen (Linear)

実装に出てくる判断 1 つ 1 つ（border radius を 6 にするか 8 にするか、hover の
opacity を 0.8 にするか 0.7 にするか、padding を 12 にするか 16 にするか）に
**意図がある状態** を目指す。「default だから」「テンプレがそうだったから」で残った
判断はすべて疑う。

## 階層（Hierarchy）

階層は **色だけ** で作らない。複数の手段を **組み合わせる**:

| 手段 | 例 |
|---|---|
| Size | 見出しを本文の 1.5〜2 倍 |
| Weight | 強調は weight、色は控えめ |
| Color contrast | 強調 = 100% / 補助 = 60% / 弱 = 40% の opacity |
| Spacing | 関連要素を近く、無関係を遠く |
| Position | 重要 = 上 / 左 |

**Refactoring UI の鍵**: 強調は **薄い灰色を背景に黒文字** のような contrast の差で
作る。"emphasize by de-emphasizing"。重要な要素を派手にするのではなく、周りを
控えめにする。

```
❌ 全部黒文字、強調だけ赤
✅ 全部やや薄め、強調だけフル黒
```

## タイポグラフィ

### 書体の選定

- 1 family で完結させようとしない。**Sans + Mono の 2 family** が最小単位
- Inter / Roboto を「default だから」で選ばない（`anti-ai-ui` 参照）
- DevTools 系: `Berkeley Mono` / `JetBrains Mono` / `IBM Plex Mono` の使用比率を高める
- 数値表示には `font-variant-numeric: tabular-nums`

### スケール

modular scale を採用する。`1, 1.125, 1.25, 1.5, 1.875, 2.25, 3` 等。
**「いい感じの数字」を毎回拾わない**。spreadsheet 的に決め打つ。

- Body: 14px (情報密度高い app) / 16px (汎用)
- Line height: 本文 1.5、UI ラベル 1.2-1.3
- 見出しは「サイズを大きく」より「重く・絞って・上下に空間」

### 行長

本文 60-75 字 / 行が目安。`max-w-prose` 程度。
ただし **表・コード・ログ** は適用外。情報密度が落ちる。

## 色

### パレットの組み立て

Refactoring UI の流儀:

- Greys: 8〜10 段階（ほぼ単色の濃淡）
- Primary: 1 色 × 8〜10 段階
- Accent (success, warning, danger, info): それぞれ 8〜10 段階
- 全部で 40〜50 色のパレット

「メインカラー 1 つ」だけだと UI が痩せる。**各色の段階バリエーション** が多様な
強調・状態表現を可能にする。

### コントラスト

WCAG AA は **最低限**。読みやすさを目的に AAA を狙う。
DevTools 系では特に文字色が灰色になりがちだが、コア情報は AAA、補助は AA を厳守。

### ニュアンス

すべての灰色を「真の灰色」にしない。**わずかに hue を寄せる**（cool grey / warm grey）。
これが「無味」と「丁寧」の差。

```css
/* ❌ 真の灰色 */
--gray-500: #737373;

/* ✅ わずかに blue を含んだ灰色（Linear 風） */
--gray-500: #6e7077;
```

## 空間（Spacing）

- 8px グリッド（または 4px）に揃える
- 「余白多めの方が大抵正しい」（Refactoring UI）
- ただし密度の意図がある画面（`devtools-aesthetic`）では別の grid（2px / 4px）
- **空白を「装飾」と考えない**。情報のグルーピングのために使う

related items を近づけ、unrelated を離す。これだけで section divider が不要になる。

## Border vs Shadow

「浮いてる感」を出す手段は 2 つ:

| 場面 | 推奨 |
|---|---|
| インラインのカードを区切る | 1px hairline border |
| Modal / Popover / Toast | shadow + 小さい border 両方 |
| Dropdown | shadow メイン |
| 静止平面の section | spacing と background contrast のみ。border も shadow も使わない |

Linear 風: `1px solid rgba(255,255,255,0.08)` のような **限りなく薄い** hairline を
基調にする。

## Border Radius

- 0px / 2-4px / 6-8px / 10-12px / full のいずれかから **2 種類だけ** 選ぶ
- DevTools 系では radius を絞る（多用すると技術的シリアスさが薄れる）
- 角丸を「親 > 子」関係で揃える（親の内側 = 親の radius - padding が原則）

## Iconography

- 1 icon set に絞る。3 つ並べない（lucide + heroicons + material は混ぜない）
- stroke width / corner radius が UI の他の要素と整合するものを選ぶ
- size grid を決める（`14, 16, 20, 24`）

## ディテール

Rauno (Devouring Details) のテーマ:

- **Inferring intent**: ユーザの「次にやりたいこと」を先読みする UI
  （例: 検索結果 1 件しかない時に Enter で即遷移）
- **Interaction metaphors**: 操作に物理的・空間的アナロジーを与える
- **Ergonomic interactions**: 手が動く距離・指の自然な位置に合わせる
- **Simulating physics**: 慣性・抵抗・摩擦の感覚を伝える
- **Motion choreography**: 複数要素の動きの順序が意味を持つように
- **Responsive interfaces**: 入力の遅延ゼロ。何かが起こることが即座に分かる

「**Quality is a function of patience and focus**」(Rauno) — 細部に時間をかける
こと自体が品質。

## Linear からの実務原則

- **小さなチームで決める**: 3-5 人で議論。委員会化しない
- **直感を信じる**: 数値最適化より「気持ちいいか」で判断
- **0-bug ポリシー**: 既知の問題を残さない（7 日以内）
- **内部使用を先行**: 半端な状態で外に出さない
- **担当範囲を固定しない**: design / engineering の境界を曖昧にして全員が
  品質に責任を持つ

## 自己レビュー

実装後、以下を声に出して問う:

- [ ] 色は **必要最小限の hue 数** か（多くても 2-3）
- [ ] 階層は **複数の手段** で表現されているか（色だけに依存していないか）
- [ ] 同じ意味の要素は **同じ treatment** か（揺れていないか）
- [ ] 余白は **意図的** か（適当に詰めただけになっていないか）
- [ ] `anti-ai-ui` の tell sign に該当していないか
- [ ] **典型的に default を選んだ判断はどれか**、それは正しいか
- [ ] 1 つでも「ここに時間をかけた」と胸を張れるディテールがあるか

## 関連スキル

- 避けるべきパターン: `anti-ai-ui`
- 動き: `motion-restraint`
- 情報密度・パネル: `devtools-aesthetic`
- 包括: `ui-design-craft`
