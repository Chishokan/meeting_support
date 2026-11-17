# 動画「成績管理 生徒の追加」の作り方

PDF の「成績管理 生徒の追加 マニュアル」（`../../seiseki-student-manual.html`）の動画版（12枚・2分ほど）。受験票を作るために、
成績入力の［＋ 生徒を追加］で生徒を足し、受験票を印刷するまで。県一斉模試の名簿の取り込みは管理部門がするので入れていない。
しくみはログインの動画（`../login-basic/`）と同じ。ナレーションは音読さんで作る。

| ファイル | 中身 |
|---|---|
| `storyboard.mjs` | 台本。スライド1枚ごとの字幕（kicker / title / body / note / tip）と読み上げ原稿（say） |
| `台本_音読さん用.txt` | 音読さんに貼る原稿と、保存する mp3 の名前（`storyboard.mjs` の say と同じ文） |
| `slides.html` | スライドの見た目（1920×1080。上に手順の帯、左に画面写真、右に字幕） |
| `shots/` | 赤枠なしの画面写真（2倍の解像度）と、強調する枠の位置（`shots/<名前>.json`。CSS の px） |
| `shots.js` | 画面写真を撮るスクリプト（受験票の写真 `v06_ticket` は同じ作りで撮った） |
| `render.mjs` | コマ撮りして `out/seiseki-student.mp4` と `out/poster.jpg` を作る |

`audio/` 以外の作業用（`frames/` `out/` `data.js`）は git に入れない。

## ナレーション入りの動画を作る（いまは音声待ち）

1. `台本_音読さん用.txt` の【1】〜【12】を、1枚ずつ音読さんに貼って読み上げ、mp3 を「保存名」の名前（`01_title.mp3` 〜 `12_end.mp3`）で
   このフォルダの `audio/` に置く。声・速さ・高さはすべて同じにする
2. 動画を作る

   ```sh
   cd docs/manual/video/seiseki-student
   node render.mjs            # 音声の長さに合わせて各スライドの表示時間が決まる
   node render.mjs --silent   # 音声なし（字幕だけ）。見た目の確かめ用
   ```

   音声が足りないスライドがあると、名前を出して止まる（字幕だけで作るときは `--silent`）
3. できた `out/seiseki-student.mp4` を `public/manual/seiseki-student.mp4` に、`out/poster.jpg` を `public/manual/seiseki-student-poster.jpg` に置き、
   `lib/manuals.ts` の 'seiseki-student'（PDF）のすぐ後に動画を足す（例：id 'seiseki-student-video'、title '動画：成績管理 生徒の追加'、
   kind 'video'、href '/manual/seiseki-student.mp4'、poster '/manual/seiseki-student-poster.jpg'、meta に長さと大きさ）。CHANGELOG にも1行

## 直すとき

- 字幕や読み上げを直す：`storyboard.mjs` を直し、`台本_音読さん用.txt` も同じ文に直す（say を変えたスライドの mp3 は作り直す。render.mjs は中身の違いまでは見分けられない）
- 読み上げは記号・数字で崩れやすいので、say は読み方で書く（例：0301 →「ゼロさんゼロイチ」、518-01 →「ごひゃくじゅうはちの、ゼロイチ」、CSV →「シーエスブイ」）
- 画面が変わったら写真を撮り直す：アプリの写しを手元で起動し（`.data/moshi.json` に架空の回（時間割の時刻も）と名簿＝日野校 0001〜0005）、
  `node docs/manual/video/seiseki-student/shots.js http://localhost:3125`。`shots/<名前>.json` の `boxes` の `n` が台本の `focus` の番号
- 写真の生徒・職員の氏名は架空（職員は智翔 花子・小中等部）。本番のスプレッドシートには何も書き込んでいない
