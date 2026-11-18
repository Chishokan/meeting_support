# 動画「イベント申込管理 声掛け名簿の使い方」の作り方

PDF の「イベント申込管理 教室担当者マニュアル」（`../../event-list-manual.html`）の動画版（14枚・2分18秒ほど）。教室担当者向けに、
名簿の開き方、「次にすること」と ★、スイッチでの記録と保存の見方、反応とメモ、一括で記録、絞り込みと並び順、申込の状況、名簿外の申込、困ったとき。
管理部門だけに出る「校舎ごとの進み具合」は入れていない。しくみは成績管理の動画（`../seiseki-student/`）と同じ。

| ファイル | 中身 |
|---|---|
| `storyboard.mjs` | 台本。スライド1枚ごとの字幕（kicker / title / body / note / tip）と読み上げ原稿（say） |
| `台本_音読さん用.txt` | 音読さんに貼る原稿と、保存する mp3 の名前（`storyboard.mjs` の say と同じ文） |
| `slides.html` | スライドの見た目（1920×1080。上に手順の帯、左に画面写真、右に字幕） |
| `shots/` | 赤枠なしの画面写真（2倍の解像度）と、強調する枠の位置（`shots/<名前>.json`。CSS の px） |
| `shots.js` | 画面写真を撮るスクリプト |
| `render.mjs` | コマ撮りして `out/event-list.mp4` と `out/poster.jpg` を作る |

`audio/` 以外の作業用（`frames/` `out/` `data.js`）は git に入れない。

## いま置いてあるもの（2026-11-18）：字幕だけの版（音声なし）

`public/manual/event-list.mp4`（2分18秒・約5.3MB）と `event-list-poster.jpg` は、`node render.mjs --silent` で作った**字幕だけの版**。
ナレーションの mp3 がまだ無いため。`lib/manuals.ts` の meta にも「字幕のみ（音声なし）」と書いてある。

## ナレーション入りにする

1. `台本_音読さん用.txt` の【1】〜【14】を、1枚ずつ音読さんに貼って読み上げ、mp3 を「保存名」の名前（`01_title.mp3` 〜 `14_end.mp3`）で
   このフォルダの `audio/` に置く。声・速さ・高さはすべて同じにする（これまでの動画と同じ声にそろえる）
2. 動画を作る

   ```sh
   cd docs/manual/video/event-list
   node render.mjs            # 音声の長さに合わせて各スライドの表示時間が決まる
   node render.mjs --silent   # 音声なし（字幕だけ）。見た目の確かめ用
   ```

   音声が足りないスライドがあると、名前を出して止まる
3. できた `out/event-list.mp4` を `public/manual/event-list.mp4` に、`out/poster.jpg` を `public/manual/event-list-poster.jpg` に置き、
   `lib/manuals.ts` の 'event-list-video' の meta（長さ・大きさ。「字幕のみ（音声なし）」を外す）と desc を直す。CHANGELOG にも1行

## 直すとき

- 字幕や読み上げを直す：`storyboard.mjs` を直し、`台本_音読さん用.txt` も同じ文に直す（say を変えたスライドの mp3 は作り直す）
- 読み上げは記号で崩れやすいので、say は読み方で書く（例：QR コード →「キューアールコード」、★ →「ほしのしるし」、✓ →「チェックのしるし」、1〜3秒 →「一秒から三秒」）
- 画面が変わったら写真を撮り直す：手元のアプリの `.data/event.json` に `docs/manual/event/data.json`（架空の名簿・記録・フォームの回答）を写して起動し
  （`npx next dev -p 3126`）、`node docs/manual/video/event-list/shots.js http://localhost:3126`。撮るたびに `.data/event.json` を上書きすること。
  `shots/<名前>.json` の `boxes` の `n` が台本の `focus` の番号。名簿の写真は右端の「メモ」の列を外して大きく見せている（shots.js の LIST）
- 写真の生徒・職員の氏名（職員は智翔 花子・小中等部）、記録、フォームの回答は架空。本番のスプレッドシートには何も書き込んでいない
