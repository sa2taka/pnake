# Roadmap

フェーズ単位の段階開発。各 Phase の **Definition of Done (DoD)** を満たすまで次に進まない。
タスクの粒度は `TASKS.md` 参照。

## Guiding Principle

- **動くものを早く、価値を順序付けて積む**
- 各 Phase は単独で「pdfinfo より価値がある」状態に到達する
- 美しいコードより、価値の検証を優先（ただし IR と Worker 境界は最初から固める）

---

## Phase 0: Foundation
**目標:** 開発を始められる土台。コードはまだ動かなくてよい。

- [ ] Vite + React + TypeScript セットアップ
- [ ] Worker bundle 設定（vite-plugin-comlink などは使わず素の Worker）
- [ ] `src/shared/ir-types.ts` を `DATA_MODEL.md` から生成的に手書き
- [ ] `src/shared/protocol.ts` メッセージ型
- [ ] テストランナー（vitest）
- [ ] CI（型チェック・テスト・lint）
- [ ] ESLint / Prettier 最小設定

**DoD:** Hello world ページがブラウザで開き、Worker と ping-pong できる。CI 緑。

---

## Phase 1: PDF Object Explorer
**目標:** PDF を開いて、object graph をツリー表示し、各 object の raw / decoded dict を見られる。

### スコープ

- File drop / open
- File structure 解析: header / xref(table/stream) / trailer / EOF / incremental updates
- Indirect object 列挙
- Object stream 展開
- Dict / array / name / string / int / real / ref の値表現
- Stream dict 表示（中身は別タブで lazy）
- Filter chain 認識（FlateDecode 展開だけは実装）
- Tree Panel の Objects / File mode
- Detail Panel の Raw / Technical タブ
- Bottom Drawer の Raw bytes / Decoded stream タブ

### 非スコープ

- PDF.js での描画
- Content stream の解析
- Explanation の Human 文
- 暗号化 PDF（対応外として警告）

**DoD:**

- 標準的な PDF（暗号化なし、incremental update なし）の object graph を完全表示できる
- 任意の object の raw bytes と decoded stream（FlateDecode のみ）が見られる
- ツリーノードからクリックで Detail / Bottom が同期する
- 1MB の PDF を 1 秒以内に解析できる
- 壊れた xref でも warnings 付きで表示できる（少なくとも 1 ケース）

---

## Phase 2: Page Content Stream Explorer
**目標:** ページの content stream を operator 単位で見て、文字 / 画像 / パスの分類が分かる。

### スコープ

- PDF.js でページ描画（Render Panel）
- Pages tree 解決、page inheritance
- Content stream の tokenize → operator list
- Operator category 分類（text/image/path/...）
- Tree Panel の Pages / Content mode
- Bottom Drawer の Operator trace タブ
- Detail Panel の Technical タブ（operator メタデータ）

### 非スコープ

- Overlay（SVG 描画は Phase 3）
- Graphics state simulation（Phase 3）
- Image preview（Phase 4）

**DoD:**

- 標準的な PDF で、各ページの operator list が完全に出る
- operator のカテゴリが正しい
- PDF.js 描画と自前 IR が同居する
- 100 ページ PDF を扱える（per-page lazy）

---

## Phase 3: Graphics State + Resources + Overlay
**目標:** 「クリックした描画要素から、その元の operator / object に辿れる」体験を実現する。

### スコープ

- Graphics state simulator（CTM, line width, dash, color, text state）
- Resource resolver（Font / XObject / ExtGState / ColorSpace）
- Visual element index（bbox 付き）
- Render Panel に SVG overlay
- Tree ↔ Overlay ↔ Detail の選択同期
- Detail Panel の Human タブ（Explanation 第一弾）
- Explanation 辞書（operator → 説明文）

**DoD:**

- ページ上のテキスト bbox / 画像 bbox をクリックすると、対応 operator が選択される
- 逆も成立する
- すべての主要 operator に Human 説明がある
- text run の Unicode 抽出が ToUnicode CMap 経由でできる（部分対応で可）

---

## Phase 4: Performance & Robustness
**目標:** 巨大・壊れた PDF でも実用に耐える。必要なら WASM 投入。

### スコープ

- 仮想化ツリー（10000+ ノード）
- Stream decode の LRU cache
- 暗号化 PDF（RC4 / AES）対応
- 壊れた PDF の修復ヒューリスティック
- WASM 投入の計測と判断（DCTDecode 等）
- メモリプロファイリングとリーク対策

**DoD:**

- 500MB PDF で初期 manifest が 5 秒以内
- ページ切替が 200ms 以内
- 壊れた xref / 不正な stream length でも落ちずに warnings 表示

---

## Phase 5: Logical Structure & Validation
**目標:** Tagged PDF / 論理構造 / 検証系。

### スコープ

- StructTreeRoot 解析
- Logical Structure View
- Marked content と StructElem の対応
- AcroForm / XFA 検出
- 署名検出（検証はしない）
- 簡易 PDF/A チェック（部分）

**DoD:**

- tagged PDF で論理ツリーが表示される
- form fields が一覧できる
- 署名済み PDF で署名の存在と範囲が分かる

---

## Phase 6 以降（任意）

- Incremental update の time-travel ビュー（古い revision の object）
- Embedded files 抽出
- Annotation の詳細表示
- ColorSpace 変換シミュレーション
- 説明文の英語化
- 教育モード（一連の operator を解説しながら順に再生）

---

## バージョニング方針

- Phase 1 完了で v0.1
- 各 Phase 完了で minor を上げる
- v1.0 は Phase 3 完了時点を想定
