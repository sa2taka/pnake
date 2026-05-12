---
name: lossless-ir-design
description: 元データの情報を失わない Intermediate Representation（IR）を設計する。コンパイラ・リンタ・フォーマットインスペクタ・トランスパイラ等で、ソース byte range / provenance / 多層意味付けを保ったまま下流の解析を載せていくための型設計と運用パターンを提供する。トリガー: AST / IR / 構造化解析結果の型を設計、parser の出力を下流ツールに渡す境界を設計、UI から「ここはどこから来た情報？」を答える必要があるとき。
---

# Lossless IR Design

「raw 情報を失わない」中間表現を設計するためのガイド。

## 出発点となる問い

- IR を見せた相手が、必ず元の byte / token / source location に辿れるか？
- 同じ情報を **異なる抽象度** で見たい時、ジャンプできるか？
- 解析を 1 段足したい時、既存ノードに追加で済むか？（新規 IR を派生させない）
- 部分的に壊れた入力でも、読めた範囲は IR に乗るか？

これらが Yes になる設計を目指す。

## 4 つの設計原則

### 1. Provenance を切らない

すべてのノードに「どこから来たか」を持たせる。

```ts
type Provenance = {
  byteRange?: { start: number; end: number };
  sourceFile?: string;                 // multi-file の場合
  parentNodeId?: string;
  originalToken?: string;              // 元 token への参照（lex 段階の ID）
};
```

provenance はオプショナルにしない（または「持たない理由」を型でドキュメント化）。
1 ノードでも切れると、UI / エラー報告で「謎の情報」になる。

### 2. 多層意味付け（Raw / Decoded / Explained）

```ts
type IRNode = {
  id: string;
  kind: NodeKind;
  raw: RawForm;            // 元バイト or token
  decoded?: DecodedForm;   // 型解決後
  explained?: Explanation; // 人間向け
  provenance: Provenance;
};
```

各層は **派生関係** を保つ:

- `raw` だけは必ずある（lossy にしない）
- `decoded` は raw から計算可能（再計算できれば cache でも OK）
- `explained` は decoded から（あるいは raw から直接）派生

「raw を捨てて decoded だけ持つ」は短期的には軽くて速いが、後から復元できない。
復元できる代替は、文字列化した raw を別ストアに残す（DB / 添付 blob）等。

### 3. Linkable な ID

ID は **安定キー**。同じ入力なら何度パースしても同じ ID を再生成できることを目標にする。

- `obj:12:0` のようなドメイン由来 ID（再現可能）
- 連番 ID は再パースで変わるので避ける
- ID は文字列にする（数値より将来拡張しやすい）

ID で双方向リンクを張る:

```ts
type Link = { fromId: string; toId: string; kind: LinkKind };
```

UI / 下流ツールが「related」を辿れる。

### 4. Lazy fetch contract

巨大な内容は IR に inline しない。**ハンドル** で参照する。

```ts
type StreamHandle = {
  byteRange: { start: number; end: number };
  filters: string[];
  // 中身は持たない
};
```

ハンドルから実体を取る関数（または method）を別途定義。
manifest が肥大化しない、初期表示が速い、メモリも安全。

## ノード階層

ノードは **kind discriminator** で union 型にする。

```ts
type IRNode =
  | { kind: "container"; ... }
  | { kind: "leaf"; ... };
```

- 過度に深い継承階層は避ける。kind を 1 階層に並べる
- 共通フィールドは intersection で `BaseNode & SpecificNode` 構成にする
- TypeScript なら discriminated union が最も扱いやすい

## 警告ストリーム

「壊れているが読めた」「曖昧だが解釈した」は warning として残す。
**throw / swallow / log** ではなく、IR に同居させる。

```ts
type IRWarning = {
  id: string;
  severity: "info" | "warn" | "error";
  message: string;
  byteRange?: ByteRange;
  relatedNodeIds?: string[];
};
```

UI で「⚠ 12 warnings」のように表面化でき、レビュー時に「parser がこっそり swallow した」
を防げる。

## 進化させる時

IR に新しい情報を足したくなった時:

| ケース | 取るべき手段 |
|---|---|
| 既存 kind に追加情報 | 既存型に optional フィールド追加 |
| 解析の中間結果 | 別ストアに置く（IR の一級市民にしない） |
| 別解釈（例: 異なる version の解釈） | 同じ ID に複数の解釈を attach（version 付き） |
| 新しい構造概念 | 新 kind を追加（既存を変えない） |

**新規 IR を派生させない**。下流ツールが追従できなくなる。
どうしても根本的に変えたいなら、version field を入れて両方を持つ移行期間を作る。

## シリアライズ

IR を Worker / network / IndexedDB に送る場合:

- structured clone 可能であること（function / class instance / Symbol を含めない）
- 大きな Uint8Array は Transferable で渡す
- ID は短く（プレフィクスと番号）
- 不要な深さは避ける（フラットマップ + ID 参照の方が転送が速い）

```ts
type SerializedIR = {
  nodes: Record<string, IRNode>;     // id → node
  rootIds: string[];
  links: Link[];
  warnings: IRWarning[];
};
```

ツリー構造を「`children: IRNode[]`」で持つと深い再帰になる。
**ID 参照のフラット構造** + 「childrenIds: string[]」を推奨。

## Single Source of Truth

IR 型は **ドキュメント主導**で運用する。

- 型の正本: `docs/DATA_MODEL.md`（このプロジェクトでは）
- コード: `src/shared/ir-types.ts`
- 変更時: ドキュメントとコードを **同じ PR で** 更新

レビューでも「DATA_MODEL.md と一致しているか」を見る。乖離を許すと負債が増える。

## アンチパターン

- raw を decoded で上書き（lossy）
- provenance を「テスト用」と扱って production で削る
- ID を増分連番（再現性なし）
- 解析 N 段目ごとに別 IR を派生（下流が追従不能）
- 深い再帰 tree + cycle あり（serialize 不可）
- warning を log に流して IR に残さない
- ハンドルを使わず巨大バイナリを inline
- TypeScript の interface を継承で連ねて kind 判別を曖昧化

## 自己レビュー

- [ ] すべてのノードに provenance がある
- [ ] raw / decoded / explained のどの層からも他層に辿れる
- [ ] 同じ入力で同じ ID が再現できる
- [ ] 巨大データは inline ではなくハンドル
- [ ] 警告は IR に同居している
- [ ] 新しい解析を足す時に既存 kind を増やすだけで済む構造になっている
- [ ] 型の正本（ドキュメント）と コードが一致している
