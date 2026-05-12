---
name: web-worker-orchestration
description: Web Worker と main thread の境界設計・メッセージプロトコル・進捗とキャンセル・Transferable・Worker プールを実用的に組み立てるパターンを提供する。トリガー: 重い処理を Worker に逃がす、Worker 越境の API を設計、UI スレッドのブロック解消、parser や image decoder のオフロード等。
---

# Web Worker Orchestration

UI スレッドをブロックせず、重い処理を Worker で安全に動かすための設計パターン。

## いつ Worker を使うか

main thread で 16ms を超える処理。具体的には:

- パーサ・コンパイラ・トランスパイラ
- 暗号化・ハッシュ・圧縮
- 画像 / 動画 / 音声デコード
- 大量の数値計算（行列・FFT）
- 構造化データの索引化・検索

DOM 操作、`fetch` 結果の単純な変換、`requestIdleCallback` で済む小計算は **不要**。

## 何を入れない（main thread に残す）

- DOM / window 関連
- React の render
- 「結果を見せる」最終段の整形
- 軽い操作（ms 単位で終わる）

## メッセージプロトコル設計

### 1. 型付きメッセージ

```ts
// shared/protocol.ts
export type WorkerRequest =
  | { id: number; type: "load"; bytes: ArrayBuffer }
  | { id: number; type: "getPage"; pageNumber: number }
  | { id: number; type: "getStream"; objectRef: string; mode: "raw" | "decoded" };

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: WorkerError }
  | { id: number; progress: number }; // 0..1
```

`id` を必ず付けてリクエスト/レスポンスを対応付ける。これがないと並行リクエストが混線する。

### 2. main 側 facade

```ts
class WorkerClient {
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void; onProgress?: (p: number) => void }>();

  constructor(private worker: Worker) {
    worker.onmessage = (e) => this.handle(e.data);
  }

  call<T>(req: Omit<WorkerRequest, "id">, onProgress?: (p: number) => void): Promise<T> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as any, reject, onProgress });
      this.worker.postMessage({ ...req, id });
    });
  }

  private handle(msg: WorkerResponse) {
    const p = this.pending.get(msg.id);
    if (!p) return;
    if ("progress" in msg) { p.onProgress?.(msg.progress); return; }
    this.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result); else p.reject(msg.error);
  }
}
```

これだけで Comlink 等の依存は要らない。要件が増えてから検討する。

### 3. Worker 側 dispatcher

```ts
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    const result = await handle(req, (p) => self.postMessage({ id: req.id, progress: p }));
    self.postMessage({ id: req.id, ok: true, result });
  } catch (error) {
    self.postMessage({ id: req.id, ok: false, error: serialize(error) });
  }
};
```

## Transferable Objects

大きな binary は **コピーせず転送**。

```ts
// main → worker
worker.postMessage({ id, type: "load", bytes: buffer }, [buffer]);
// → main 側で buffer は detach され、Worker 側で受け取られる

// worker → main
self.postMessage({ id, ok: true, result: { decoded } }, [decoded.buffer]);
```

転送できるもの:

- `ArrayBuffer`
- `MessagePort`
- `ImageBitmap`
- `OffscreenCanvas`
- `ReadableStream` / `WritableStream` / `TransformStream`

`structured clone` で済むなら明示的 transfer は不要だが、巨大データは必ず transfer する。

## 進捗報告

長時間処理は **強制的に進捗を出す**（出さないと UI が「死んだ」と思われる）。

- 0..1 の `progress` を `id` 付きで送る
- 過剰に送らない（数 100 メッセージ/秒は逆効果）。throttle して 10Hz 程度
- 不確定なら `progress: -1` でスピナー表示に切替

```ts
async function parse(bytes: Uint8Array, onProgress: (p: number) => void) {
  let last = 0;
  for (let i = 0; i < bytes.length; i++) {
    // ...
    if (performance.now() - last > 100) {
      onProgress(i / bytes.length);
      last = performance.now();
    }
  }
}
```

## キャンセル

長時間処理を中断できるようにする。**`AbortController` パターン** が最も読みやすい。

```ts
// shared
export type WorkerRequest = ... | { id: number; type: "cancel"; targetId: number };

// worker 側
const abortControllers = new Map<number, AbortController>();

async function handle(req: WorkerRequest) {
  if (req.type === "cancel") {
    abortControllers.get(req.targetId)?.abort();
    return;
  }
  const ac = new AbortController();
  abortControllers.set(req.id, ac);
  try {
    return await doWork(req, ac.signal);
  } finally {
    abortControllers.delete(req.id);
  }
}
```

`doWork` 内のループで `if (signal.aborted) throw new DOMException(...)` をチェックする。
これを怠ると cancel が効かない。

## Worker pool

CPU バウンドな処理を並列化したい場合のみ。`navigator.hardwareConcurrency` を上限の目安に。
注意点:

- 各 Worker は **独立した状態**。同じ PDF を 2 つの Worker で持つとメモリが倍
- 状態を持たない関数だけ並列化する（pure な decode 等）
- queue + round-robin が単純で十分

```ts
class WorkerPool {
  private workers: Worker[];
  private nextIndex = 0;
  pick() { return this.workers[(this.nextIndex++) % this.workers.length]; }
}
```

## メモリと寿命

- Worker は **明示的に terminate** する。閉じ忘れるとメモリリーク
- ファイル単位で Worker を作って終わったら捨てる、もリーズナブル
- IR を long-lived な Worker に長く置く場合は LRU + 上限管理

## エラー処理

- Worker 内の throw は serialize して main へ送る
- `Error` のフィールドだけ抽出（class はクローンされない）

```ts
function serialize(e: unknown) {
  if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack };
  return { name: "UnknownError", message: String(e) };
}
```

- `worker.onerror` も登録（uncaught）

## デバッグ

- Worker は Sources panel で別ファイルとして見える
- `console.log` は出るが、main と Worker のログを並べる方法は少ない → timestamp 付きで両方に出す
- `--source-map` を Worker bundle にも適用する

## アンチパターン

- 1 リクエスト 1 Worker（terminate コストが無視できない）
- 全部 main thread に postMessage で取り戻して再加工（往復が増える）
- 進捗を返さず無音
- cancel 機構なしで長時間処理
- structured clone できない値（Function, Map of Function 等）を送ろうとする
- Worker 内で `XMLHttpRequest` を sync で使う（古いコード）

## 自己レビュー

- [ ] リクエスト/レスポンスに id が付いているか
- [ ] 大きい binary は Transferable で送っているか
- [ ] 進捗が出るか
- [ ] cancel が効くか
- [ ] Worker 内で throw した時に main で catch できるか
- [ ] terminate のタイミングが明確か
