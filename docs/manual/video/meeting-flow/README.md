# 動画「部門会議の新しい流れ（事前共有の確認・議題の追加・Zoom参加）」

PDF マニュアル（`../../meeting-flow-manual.html`）の動画版（18枚）。しくみはリポジトリの `docs/manual/video/event-list/` と同じ。

| ファイル | 中身 |
|---|---|
| `storyboard.mjs` | 台本。スライド1枚ごとの字幕と読み上げ原稿（say） |
| `台本_音読さん用.txt` | 音読さんに貼る原稿と、保存する mp3 の名前（say と同じ文） |
| `slides.html` | スライドの見た目（1920×1080） |
| `shots/` | 赤枠なしの画面写真と、強調する枠の位置（`.json`） |
| `render.mjs` | コマ撮りして `out/meeting-flow.mp4` と `out/poster.jpg` を作る |
| `out/meeting-flow.mp4` | いまは**字幕だけの確認版**（ナレーションなし・約3分） |

## ナレーションを入れる

1. `台本_音読さん用.txt` の【1】〜【18】を音読さんで読み上げ、mp3 を「保存名」の名前（`01_title.mp3` 〜 `18_end.mp3`）で `audio/` に置く。声・速さ・高さはこれまでの動画と同じにする
2. リポジトリ（`npm ci` 済み）の直下で `node <このフォルダ>/render.mjs` を実行する。音声の長さに合わせて各スライドの表示時間が決まる（字幕だけなら `--silent`）

## 写真を撮り直す

- ダッシュボードの写真：`VIDEO=1 node docs/manual/meeting-flow/shots.js <出力フォルダ> http://localhost:3127`（アプリは `npx next dev -p 3127`）。`mt_*.png/json` を `shots/v_*` の名前で置く
- 智翔館AI の写真：`CHISHOKAN_AI_MEMBERS='*' npx next dev -p 3127` で起動し、`node docs/manual/meeting-flow/shots-ai.js <マニュアル写真> <動画写真>`
- 会議・議題・氏名・ミーティングIDは架空。本番には何も書き込まない
