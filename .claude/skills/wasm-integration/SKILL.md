---
name: wasm-integration
description: フロントエンドプロジェクトに WebAssembly（Rust + wasm-bindgen, AssemblyScript, C++ + Emscripten 等）を導入するときの判断基準・ビルドパイプライン・メモリ境界設計・フォールバック・サイズ予算を提供する。トリガー: 既存 JS/TS の性能ボトルネックを WASM で解決したい、暗号 / decoder / 数値演算を高速化したい、既存 C/C++/Rust ライブラリをブラウザに持ち込みたい等。
---

# WASM Integration

WebAssembly をフロントエンドに導入するときの設計ガイド。
「とりあえず Rust」をやる前に **本当に必要か** を計測すること。

## いつ WASM が正解か

**Yes（高い確度で）**:

- 既存 C/C++/Rust 実装を再利用したい（zlib, libjpeg, libpng, OpenCV 等）
- ホットループが CPU バウンド（画像 / 音声 / 暗号 / 数値）
- JIT の warm-up を待てない（決定論的 latency が欲しい）
- メモリレイアウトを細かく制御したい（zero-copy）

**No（多くの場合）**:

- 「速いと聞いたから」（計測していない）
- DOM 操作 / 文字列処理が中心
- TS で素朴に書けば 16ms 以内に終わる
- バンドルサイズに余裕がない（WASM 自体 + glue で数 100KB〜）
- メンテナが TS しか書けない

**まず TS で書き、計測してから WASM に移す**。これが鉄則。

## 言語選定

| 言語 | 強み | 弱み |
|---|---|---|
| Rust + wasm-bindgen | エコシステム、安全、`web-sys` で DOM access | コンパイル遅い、bundler 統合がやや複雑 |
| AssemblyScript | TS に近い、学習コスト低 | コミュニティ小、Rust ほどの性能は出にくい |
| C/C++ + Emscripten | 既存 C ライブラリ移植 | glue が複雑、デバッグ困難 |
| Zig | バイナリ小、構造シンプル | エコシステム未成熟 |

迷ったら Rust + wasm-bindgen + wasm-pack。

## ビルドパイプライン

最小構成（Rust）:

```
crate/
├── Cargo.toml          # crate-type = ["cdylib"], wasm-bindgen 依存
├── src/
│   └── lib.rs          # #[wasm_bindgen] export
└── pkg/                # wasm-pack build --target web の出力
    ├── crate_bg.wasm
    └── crate.js
```

`vite` なら `vite-plugin-wasm` を入れずに `?init` import や fetch + instantiate で十分。
**依存最小化方針** なら自前で書く:

```ts
const wasm = await WebAssembly.instantiateStreaming(fetch("crate_bg.wasm"), imports);
```

CI で `wasm-pack build` を走らせ、`pkg/` を Git に含めるか dist で配るかは決める。

## メモリ境界設計

JS ↔ WASM の境界で **最も多いバグはメモリ所有権**。

### コピーするか、view を渡すか

```ts
// Bad: 都度コピー
const ptr = wasm.alloc(input.length);
new Uint8Array(wasm.memory.buffer, ptr, input.length).set(input);
const resultPtr = wasm.process(ptr, input.length);
const result = new Uint8Array(wasm.memory.buffer, resultPtr, len).slice(); // コピー
wasm.free(ptr);
wasm.free(resultPtr);

// Better: wasm-bindgen が `&[u8]` を受け取れば自動でやる
import init, { process } from "./pkg/crate.js";
await init();
const result = process(input);
```

`wasm-bindgen` で関数シグネチャを `fn process(input: &[u8]) -> Vec<u8>` にすると、
内部でコピーが発生する（避けられない場合あり）。長寿命オブジェクトは `pointer` で
持ち続けて、操作だけ越境させると速い。

### memory grow に注意

WASM linear memory は `Uint8Array` を `wasm.memory.buffer` から作る。
**memory が grow するとビューは無効化される**。view を保持しない / 毎回再取得する。

```ts
function asView(ptr: number, len: number) {
  return new Uint8Array(wasm.memory.buffer, ptr, len); // grow 後に再呼び出し
}
```

### ライフタイム

- WASM 側に `Box::leak` で漏らさない
- JS 側で `free` を呼ぶ責務を持つラッパーを作る
- `FinalizationRegistry` で auto-free も検討（ただし保証はない）

```ts
const registry = new FinalizationRegistry((ptr: number) => wasm.free(ptr));
function wrap(ptr: number) {
  const obj = { ptr };
  registry.register(obj, ptr);
  return obj;
}
```

## Worker 内で動かす

WASM は **Worker 内で初期化** する（main thread をブロックしないため）。
`web-worker-orchestration` スキル参照。

```ts
// worker.ts
import init, { decode } from "./pkg/crate.js";
const ready = init();

self.onmessage = async (e) => {
  await ready;
  const result = decode(e.data.bytes);
  self.postMessage({ result }, [result.buffer]);
};
```

`SharedArrayBuffer` を使うとさらに速いが、`Cross-Origin-Isolated` ヘッダが必要。
ローカル開発時の DX を考えて、まずは postMessage で十分。

## フォールバック

WASM が読めない環境（古いブラウザ、CSP 厳格）に備える:

```ts
async function decode(input: Uint8Array): Promise<Uint8Array> {
  if (await isWasmAvailable()) return decodeWasm(input);
  return decodeJs(input); // 遅い TS 実装
}
```

「WASM 専用」にすると、デバッグ時にも TS 実装の代替がないので開発しにくい。
**TS 実装を維持する** ことを推奨（性能差を測る base にもなる）。

## サイズ予算

- WASM bundle: 100KB 以下を目標、500KB 超えたら理由が必要
- `wasm-opt -Oz` を必ず通す（wasm-pack は自動でやる）
- Rust の場合、`panic_abort` / `lto = true` / `codegen-units = 1` / `opt-level = "z"`
- `wee_alloc` は最新版ではデメリットが上回ることが多い。標準 alloc で計測してから決める

## デバッグ

- Source map: `wasm-pack` は dwarf を出せる。Chrome の DevTools で Rust ソースをステップ実行できる
- パニックメッセージを JS console に出す: `console_error_panic_hook`
- 重い処理は performance.mark / measure で計測

## セキュリティ

- WASM は JS と同じ origin で動く。サンドボックス効果は控えめ
- 外部ライブラリ移植の場合、CVE は親プロジェクトと同じものを持ち込む可能性がある
- `eval` 系は WASM の方が安心、という誤解に注意

## アンチパターン

- 計測せずに「速くなる気がするから」WASM
- main thread で重い WASM を呼ぶ
- 境界ごとに大量コピー
- memory grow 後の stale view を使う
- WASM 専用にして TS フォールバックを廃止
- バンドラ依存のヘビーなプラグインを入れる
- `SharedArrayBuffer` を前提にして cross-origin isolation を考慮しない

## このプロジェクトでの方針

`pnake` では Phase 4 まで WASM は導入しない（`docs/DECISIONS.md` ADR-004）。
導入時の候補:

- DCTDecode / JPXDecode（JPEG / JPEG2000）の高速化
- 暗号化 PDF の RC4 / AES decryption
- 大規模 PDF の zlib decode（標準 `DecompressionStream` で足りないとき）

導入を提案する PR は以下を含めること:

- 計測結果（before / after）
- TS フォールバックの維持方針
- バンドルサイズへの影響
- ライセンス確認
