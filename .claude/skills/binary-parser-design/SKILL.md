---
name: binary-parser-design
description: バイナリ・構造化フォーマット（PDF, MP4, ELF, ZIP, WebAssembly, Protobuf 等）のパーサ・トークナイザを設計・実装するときに使う。byte offset の保存、lazy decoding、エラー復旧、ストリーム処理を実用的に組み立てる原則と具体的なパターンを提供する。トリガー: tokenizer / lexer / parser / decoder / binary format を扱う実装やレビュー時。
---

# Binary Parser Design

バイナリフォーマットのパーサを「壊れない」「速い」「説明できる」状態で書くための原則集。

## 基本原則

### 1. byte offset を絶対に捨てない

すべてのトークン・ノード・オブジェクトに **元バイトの範囲** を保持する。

```ts
type Token = {
  kind: TokenKind;
  range: { start: number; end: number };  // exclusive end
  value?: unknown;
};
```

理由: DevTools 系 UI、ハイライト、エラー報告、cross-reference のすべてに必要。
parser を「字句解析 → 意味解析」と段階分けしても、各層で provenance を保つ。

### 2. 入力は ArrayBuffer + DataView / Uint8Array

string にせず byte で扱う。テキスト型に decode するのは「これは ASCII / UTF-8」と
仕様で確定したフィールドだけ。

```ts
class ByteReader {
  constructor(private buf: Uint8Array, private pos = 0) {}
  peek(n = 0) { return this.buf[this.pos + n]; }
  read() { return this.buf[this.pos++]; }
  slice(len: number) { return this.buf.subarray(this.pos, this.pos += len); }
  // byte offset を返すメソッドを必ず持つ
  offset() { return this.pos; }
}
```

### 3. lazy で書く（eager に decode しない）

巨大な container を扱うとき、**ヘッダ・インデックス・参照だけ** を先に読み、本体は
オンデマンドで decode する。

```ts
type StreamHandle = {
  range: ByteRange;
  filters: Filter[];
  // 中身は持たない。decode は呼ばれたとき
};

async function decodeStream(handle: StreamHandle): Promise<Uint8Array> { ... }
```

LRU cache で 1 回 decode したら覚える。サイズ上限を持たせる。

### 4. エラー復旧（recoverable parser）

「壊れた入力 = 例外で止まる」は実用的ではない。3 段階に分ける。

| 種類 | 動作 |
|---|---|
| Recoverable | warning を出して読み続ける |
| Skippable section | そのノードだけ partial にして次へ |
| Fatal | parse 全体を止める（header 不在等） |

実装パターン:

```ts
function parseObject(r: ByteReader, warnings: Warning[]): ObjectNode | null {
  try {
    return parseObjectStrict(r);
  } catch (e) {
    warnings.push({ severity: "warn", message: ..., byteRange: ... });
    // 次の "endobj" まで skip して継続
    skipUntil(r, KEYWORD_ENDOBJ);
    return null;
  }
}
```

throw は **本当に続行不能な場合** のみ。それ以外は warning にする。

### 5. 状態を持つ parser は state machine として書く

content stream のような「operand を積んで operator で確定」型は明示的に state を持つ。

```ts
class ContentStreamParser {
  private operandStack: PdfValue[] = [];
  private operations: Operation[] = [];

  feed(token: Token) {
    if (isOperator(token)) {
      const op = this.makeOperation(token);
      this.operations.push(op);
      this.operandStack = [];
    } else {
      this.operandStack.push(asOperand(token));
    }
  }
}
```

reduce/grammar 系のフレームワークに飛びつかない。多くのバイナリフォーマットは
手書きの方が明快で速い。

## トークナイザのチェックリスト

- [ ] EOF 検出（読み過ぎないこと、無限ループしないこと）
- [ ] 不正バイトで前進すること（同じ位置で stuck しない）
- [ ] 全 token に byte range を付ける
- [ ] テストで「壊れた境界」を含めること（途中で切れた string、閉じてない dict 等）
- [ ] performance: 1 文字ごとに function 呼び出しを増やさない（hot loop）

## ストリーム / フィルタ設計

ストリーム filter は **chain で表現**。

```ts
type FilterChain = Filter[];

async function applyFilters(input: Uint8Array, chain: FilterChain): Promise<Uint8Array> {
  let current = input;
  for (const f of chain) {
    current = await applyOne(current, f);
  }
  return current;
}
```

`DecompressionStream` を使うと標準で gzip/deflate/deflate-raw が使える。ブラウザ
ネイティブで速く、Worker でも使える。自前で zlib を書かない。

```ts
async function inflate(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
```

PNG predictor / TIFF predictor のような「後処理」は別関数に分ける。

## メモリ管理

- 巨大入力を **ローカル変数で複数コピーしない**。`subarray()` で view を渡す
- decode 結果は必要な範囲だけ返す（全部返すと OOM になる）
- WASM / Worker 境界では Transferable で渡す（zero-copy）

## テスト戦略

**仕様駆動でテストを書く**。実装の真似ではなく、仕様の例 / バイト列を fixture にする。

| テスト種類 | 目的 |
|---|---|
| Token unit | 単一 token のパース |
| Fragment | 完全な小さい構造のパース |
| Snapshot | 大きい構造の IR 全体（regression） |
| Fuzz | ランダムバイト列で crash しないこと |
| Corrupted fixtures | 既知の壊れ方で warning が出ること |

fuzz は単純に `Math.random()` で 1KB 生成して parser を回すだけで強い。

## アンチパターン

- 1 つの巨大関数で全部 parse する（state が分からなくなる）
- string に decode してから regex で解析する（offset を失う）
- catch して swallow（warning を残さない）
- 入力が「正しい」前提のコード（assert を本番で外す等）
- parser を main thread で動かす（UI が固まる、`web-worker-orchestration` 参照）
- 「とりあえず全部 decode」（メモリ・時間が破綻）

## チェックポイント（実装後の自己レビュー）

- [ ] 不正な入力で例外が出ないことを fuzz で確認した
- [ ] すべてのノードに byte range が付いている
- [ ] decode は lazy になっている
- [ ] 巨大入力でメモリが線形で済む
- [ ] error は warning として表面化している（swallow していない）
- [ ] state の遷移が読める単位に分かれている
- [ ] 仕様のサンプルに対するテストがある

## 参考: PDF に特化した話

このプロジェクトでの具体は `docs/ARCHITECTURE.md` と `docs/DATA_MODEL.md` を参照。
主要トークン: comment / name / string(literal/hex) / int/real / bool / null / dict 区切り
/ array 区切り / keyword / stream-endstream。
filter chain: FlateDecode, DCTDecode, JPXDecode, CCITTFaxDecode, LZWDecode, ASCII85Decode,
ASCIIHexDecode, RunLengthDecode, JBIG2Decode, Crypt。
