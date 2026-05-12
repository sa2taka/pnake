# Architecture Decision Records

設計判断の履歴。新しい判断は **末尾に追記**（既存を書き換えない）。
状態は `Accepted / Superseded by ADR-XXX / Deprecated`。

形式:

```
## ADR-XXX: タイトル
Status: Accepted
Date: YYYY-MM-DD

### Context
（背景・制約）

### Decision
（決定事項）

### Consequences
（影響・トレードオフ）

### Alternatives Considered
（検討した代替案）
```

---

## ADR-001: Frontend-only architecture
Status: Accepted
Date: 2026-05-12

### Context

ユーザは PDF の構造を解析したい。商用 SaaS ではなく、教育・デバッグ用途。
PDF はアップロードに抵抗のある内容（社外秘等）を含み得る。

### Decision

サーバ側解析を行わず、ブラウザ完結で実装する。
重い処理は Web Worker、必要に応じて WASM。

### Consequences

- アップロード不要 → プライバシー良好
- インフラコスト 0
- 巨大 PDF（500MB+）の解析は厳しい場合あり（lazy 化必須）
- qpdf / MuPDF / PDFBox 等のサーバ製品を使えない
- 暗号化 PDF の処理は WebCrypto / 自前で実装する必要がある

### Alternatives Considered

- qpdf を WASM 化したものを呼ぶ案: ライブラリサイズ・ライセンス・実装労力で見送り
- バックエンド併用: 上記要件に反する

---

## ADR-002: PDF.js は描画専用、解析は自前
Status: Accepted
Date: 2026-05-12

### Context

PDF.js には `getOperatorList()`, `getTextContent()`, `getStructTree()` 等の便利 API
があるが、これらは **PDF.js の描画用に再解釈された** ものであり、raw content stream
そのものではない。raw / decoded / explained の 3 段階を厳密に分けたい本ツールでは、
PDF.js を解析の source of truth にすると混乱する。

### Decision

PDF.js は **canvas 描画のみ** に使う。自前の parser が IR の source of truth。

### Consequences

- 開発工数は増える（tokenizer / GS simulator を書く必要）
- ただし「PDF.js の再解釈」と「raw」が UI 上で並べて見られるという独自価値が出る
- PDF.js が動かない壊れ PDF でも、自前で部分解析できる

### Alternatives Considered

- PDF.js の operator list を直接表示: 上記理由で却下

---

## ADR-003: 解析処理は Web Worker に分離
Status: Accepted
Date: 2026-05-12

### Context

PDF parsing は CPU 集約的。UI スレッドで実行すると描画が固まる。
ユーザはツリー操作・スクロール・選択をスムーズに行いたい。

### Decision

`parser-worker` を 1 つ立て、すべての解析処理をそこに置く。
main thread は IR を受け取って表示するだけ。

メッセージ設計は `web-worker-orchestration` スキルに従う。

### Consequences

- すべての API が async になる
- IR は structured clone 可能な形に制約される（function/class 不可）
- 大きい binary は `Transferable` で渡す

### Alternatives Considered

- main thread で `setTimeout` 分割: UX 不安定
- Service Worker: ユースケースに合わない（fetch をインターセプトしたいわけではない）

---

## ADR-004: WASM は Phase 4 以降の最適化手段
Status: Accepted
Date: 2026-05-12

### Context

Rust + wasm-bindgen で重い decoder（DCTDecode, JPXDecode, Flate）を高速化できる
可能性がある。一方、ビルドパイプライン・サイズ・デバッグ性のコストもかかる。

### Decision

最初は WASM を使わない。Phase 4 で必要性が計測で確認できた場合のみ導入する。
導入手順は `wasm-integration` スキルに従う。

### Consequences

- 初期実装が単純（TypeScript のみ）
- 巨大 PDF の解析速度には限界がある（実測で問題化するまで放置）

### Alternatives Considered

- 最初から Rust で書く: 不要な複雑性

---

## ADR-005: 依存最小化方針
Status: Accepted
Date: 2026-05-12

### Context

ユーザ要望: 「PDF.js などの重要なものはともかく、できる限り依存を減らしたい」。
JS エコシステムは依存が膨らみがちで、保守性・サイズ・セキュリティ面で負債になる。

### Decision

- 必須として認める: PDF.js, React, TypeScript
- 導入前に必ず代替検討: 状態管理ライブラリ / UI コンポーネント集 / アイコンフォント
- 禁止に近い: lodash / moment / 大きいユーティリティ集
- 新規依存追加 PR は本ファイルに ADR 追加必須

### Consequences

- 自前実装が増える（特に tree view / virtualized list）
- バンドルサイズが小さくなる
- 学習コストが下がる

### Alternatives Considered

- 自由に使う: ユーザ要望に反する

---

## ADR-006: IR は Single Source of Truth、ドキュメントが真
Status: Accepted
Date: 2026-05-12

### Context

IR 型を変更するたびに、UI と Worker の両方が壊れる。型変更が見落とされやすい。

### Decision

`docs/DATA_MODEL.md` を唯一の真とする。コード上の型は同期する義務がある。
IR を変更する PR は必ず `DATA_MODEL.md` を **同じ PR で** 更新する。

### Consequences

- ドキュメントが陳腐化しにくい
- レビューで型変更を検知しやすい

---

## ADR-007: Lossless IR + Explanation Layer の二層
Status: Accepted
Date: 2026-05-12

### Context

「pdfinfo の延長」では価値が薄い。非専門家向けの説明と、専門家向けの raw を両立したい。

### Decision

すべてのノードに以下を持たせる。

- Raw: 元バイト / トークン / byte range
- Decoded: filter 展開後・型解決後
- Explained: Human / Technical / Raw の 3 段階

UI から逆方向（Explained → Raw）に必ず辿れる。
詳細原則は `lossless-ir-design` スキル。

### Consequences

- IR が大きくなる（ただし lazy で manifest は小さい）
- 説明文の品質が UX を左右する。explanation 辞書は早期に整備する
