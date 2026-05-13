# pnake

PDF の中身をブラウザだけで覗くための inspector。
`xref` から `/Contents` の `Tj` まで、ツリーを開いて辿れる。

viewer の代替品ではない。
描画はそこそこにしか出ない。
代わりに、object id を入力して何が入っているかを目で読むための道具になっている。

<p align="center">
  <img src="docs/images/hero.png" alt="pnake の UI 全景。tracemonkey.pdf を読み込んだ状態" width="100%" />
</p>

画面の番号は左から、

1. 左ペインがツリー。Objects, Pages, Content, Structure, Warnings の 5 通りの見方を切り替える。
2. 中央が pdfjs-dist の描画。クリッカブルな SVG overlay を重ねていて、テキストランや画像を選ぶと対応する operator が左ペインで光る。
3. 右ペインが Detail で、選んだノードについて Human / Technical / Raw の 3 タブで段階的に出す。
4. 右上の Show drawer で下から hex ビューが開く。stream の生バイトを見たいとき用。

## どんな時に使うか

「描画は正常なのに何か変な PDF」を調べるときに一番役に立つ。
content stream まで降りて `q` `cm` `Tj` ... を順番に眺めていけば、たいてい当たりが付く。
他にも、

- xref が壊れた PDF を scan recovery で読んだとき、何が拾えて何が捨てられたかを warning から確認する
- `/StructTreeRoot` を持つタグ付き PDF で、ある段落の `MCID` がどの content operator に対応しているかを追う
- 同じ object 番号で複数 revision がある incremental update を、どっちが現行か判定する

このあたりはどれも、view を切り替えてリンクを辿るだけで終わる。

データは外に出ない。
file を選んだ瞬間にネットワーク I/O は発生しないし、ローカル storage にも書かない。
解析は Web Worker、描画は pdfjs-dist の worker、メインスレッドの React が表示するだけ。

## 動かす

```bash
pnpm install
pnpm dev
```

`http://localhost:5173` を開いて、ヘッダの Open PDF か drag&drop で PDF を渡す。

動作確認しているのは Chromium 系のみ。
Node 22 以上、pnpm 9 以上を前提にしている。

## ビューの中身

#### Objects

xref から復元した indirect object を全部並べる。
hint 欄に `/Type` と `/Subtype` を併記しているので、Catalog なのか Page なのか Font なのかは一目で分かる。
末尾に `·S` が付いている行は stream を持っているという目印。

<p align="center"><img src="docs/images/02-loaded.png" alt="Objects view" width="100%" /></p>

#### Pages

Page tree を平坦化して、ページ番号順に並べる。
MediaBox のサイズと object ref が出ているので、どこに飛べばいいか分かる。
クリックすると Objects 側の同じ Page object に選択が移る。

<p align="center"><img src="docs/images/04-pages-view.png" alt="Pages view" width="100%" /></p>

#### Content

そのページの content stream を operator 単位で展開する。
`q` で増えて `Q` で減るのと、`BT` から `ET` までの text object も、インデントで入れ子を表現する。
operator をクリックすると Detail の Human タブに日本語の説明が出て、ISO 32000-2 の節番号も併記する。
`Tj` を選べば「文字列を現在位置に描画する」のような説明、`cm` を選べば「CTM を変更する」の説明、といった具合。

<p align="center"><img src="docs/images/05-content-view.png" alt="Content stream operator timeline" width="100%" /></p>

#### Structure

`/StructTreeRoot` を持つタグ付き PDF の論理構造ツリー。
`Document`, `Sect`, `H1`, `P`, `Figure` などのタグが入れ子で並ぶ。
`MCID` のノードをクリックすれば、その mark を発した content operator までジャンプして、必要なら自動で別ページに移動する。
タグなし PDF を読ませると、何も無いということだけが書かれる。

<p align="center"><img src="docs/images/06-structure-view.png" alt="Structure view" width="100%" /></p>

#### Bottom drawer

選択中の object が stream を持っているとき、その先頭 4KiB を hex で出す。
filter 展開前の生バイト (Raw) と、`FlateDecode` などを通した後 (Decoded) を切り替えられる。
普段は閉じておいて、必要な時だけ右上の Show drawer で開く。

<p align="center"><img src="docs/images/07-bottom-drawer.png" alt="Bottom drawer hex view" width="100%" /></p>

## もっと知る

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 全体の地図
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) IR の語彙
- [`docs/DECISIONS.md`](docs/DECISIONS.md) 設計判断の経緯
