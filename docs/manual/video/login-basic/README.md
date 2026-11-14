# 動画「ログインの使い方」（給与アプリを使わない社員向け）の作り方

共通ログインの動画（`../login/`）から、給与アプリとの行き来を除いた版（12枚・約2分）。作り方は `../login/README.md` と同じ。

- 台本は `storyboard.mjs`。`reuseAudio` のあるスライドは、共通ログインの動画の音声（`../login/audio/`）をそのまま使う（原稿が同じ）
- 新しく作る音声は5枚（`01_title`・`02_flow`・`03_mail`・`09_portal`・`12_end`）。`台本_音読さん用.txt` を音読さんに貼り、
  **共通ログインの動画と同じ声・速さ・高さ**で作って `audio/` に置く
- `node render.mjs` で `out/login-basic.mp4` ができる。`public/manual/login-basic.mp4`・`login-basic-poster.jpg` に置き、`lib/manuals.ts` に足す
- メニューの写真（`shots/03b_portal_basic`）は、給与アプリを使わない架空の職員（佐世保 花子・RED個別）の画面
