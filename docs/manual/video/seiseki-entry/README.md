# 動画「成績管理 成績入力」の作り方

PDF の「成績管理 成績入力 マニュアル」（`../../seiseki-entry-manual.html`）の動画版（15枚・3分半ほど）。本番レベル模試の得点の入れ方
（画面で入れる・入力シート（CSV）で入れる・受験しない生徒）。しくみは生徒の追加の動画（`../seiseki-student/`）と同じ。ナレーションは音読さんで作る。

| ファイル | 中身 |
|---|---|
| `storyboard.mjs` | 台本。スライド1枚ごとの字幕（kicker / title / body / note / tip）と読み上げ原稿（say）、上の帯の手順（STEPS） |
| `台本_音読さん用.txt` | 音読さんに貼る原稿と、保存する mp3 の名前（`storyboard.mjs` の say から作る。下の「直すとき」） |
| `slides.html` | スライドの見た目（1920×1080。上に手順の帯、左に画面写真、右に字幕） |
| `shots/` | 赤枠なしの画面写真（2倍の解像度）と、強調する枠の位置（`shots/<名前>.json`。CSS の px） |
| `shots-from-manual.mjs` | マニュアルの写真を撮るスクリプト（`../../seiseki/entry-shots.js`）の出力から `shots/` を作る |
| `render.mjs` | コマ撮りして `out/seiseki-entry.mp4` と `out/poster.jpg` を作る |

`audio/` 以外の作業用（`frames/` `out/` `data.js`）は git に入れない。

## ナレーション入りの動画を作る（2026-11-21 に音読さんの音声15枚で作成。約3分30秒・8.1MB）

1. `台本_音読さん用.txt` の【1】〜【15】を、1枚ずつ音読さんに貼って読み上げ、mp3 を「保存名」の名前（`01_title.mp3` 〜 `15_end.mp3`）で
   このフォルダの `audio/` に置く。声・速さ・高さは生徒の追加の動画と同じにする
2. 動画を作る

   ```sh
   cd docs/manual/video/seiseki-entry
   node render.mjs            # 音声の長さに合わせて各スライドの表示時間が決まる
   node render.mjs --silent   # 音声なし（字幕だけ）。見た目の確かめ用
   node render.mjs --only 1   # 2枚目（0 から数える）のコマだけ撮る（frames/ に出る）
   ```

3. できた `out/seiseki-entry.mp4` を `public/manual/seiseki-entry.mp4` に、`out/poster.jpg` を `public/manual/seiseki-entry-poster.jpg` に置き、
   `lib/manuals.ts` の 'seiseki-entry'（PDF）のすぐ後に動画を足す（id 'seiseki-entry-video'、title '動画：成績管理 成績入力'、kind 'video'、
   href '/manual/seiseki-entry.mp4'、poster '/manual/seiseki-entry-poster.jpg'、meta に長さと大きさ）。CHANGELOG にも1行

## 直すとき

- 字幕や読み上げを直す：`storyboard.mjs` を直し、台本を作り直す（say を変えたスライドの mp3 は作り直す。render.mjs は中身の違いまでは見分けられない）

  ```sh
  node --input-type=module -e "import { SLIDES } from './storyboard.mjs'; console.log(SLIDES.map((s, i) => '【' + (i + 1) + '】保存名：' + String(i + 1).padStart(2, '0') + '_' + s.id + '.mp3\n' + s.say).join('\n\n'))"
  ```

- 読み上げは記号・数字・読み違えやすい語で崩れやすいので、say は読み方で書く（大問 →「だいもん」、計 →「けい」、CSV →「シーエスブイ」、
  Excel →「エクセル」、0点 →「ゼロ点」、Tab →「タブ」、Enter →「エンター」）
- 画面が変わったら写真を撮り直す：マニュアルと同じ手順（`docs/manual/README.md` の「成績管理 成績入力 マニュアル」）で
  `node docs/manual/seiseki/entry-shots.js 撮った写真のフォルダ http://localhost:3125` を動かし、
  `node docs/manual/video/seiseki-entry/shots-from-manual.mjs 撮った写真のフォルダ`。枠の番号は `storyboard.mjs` の先頭の説明のとおり
- 写真の生徒・職員の氏名と得点は架空（職員は智翔 花子・小中等部）。本番のスプレッドシートには何も書き込んでいない
