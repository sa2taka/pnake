# pnake

PDF の中身をブラウザだけで覗くための inspector。

<p align="center">
  <img src="docs/images/hero.png" alt="pnake の UI 全景。tracemonkey.pdf を読み込んだ状態" width="100%" />
</p>

1. ツリー (Objects / Pages / Content / Structure / Warnings を切り替え)
2. PDF.js による描画 + クリック可能な SVG オーバーレイ
3. 選択中ノードの Detail (Human / Technical / Raw)
4. 下から開く hex ビュー (stream の raw / decoded)
