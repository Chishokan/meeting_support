# 動画「智翔館AIの使い方」の作り方

「智翔館AI（試用版）利用マニュアル」（`../../chishokan-ai-manual.html`）の内容を、画面写真に強調の枠と字幕をのせた動画（22枚・約4分）にする。
作り方は `../login/README.md` と同じ（ナレーションは音読さんで作った mp3）。

- 台本は `storyboard.mjs`、音読さんに貼る原稿は `台本_音読さん用.txt`
- 画面写真（`shots/`）は、マニュアルと同じ `../../chishokan-ai/shots.js` で撮った赤枠なしの写真と枠の位置
  （`CHISHOKAN_AI_MEMBERS='*'` でアプリを起動し、`node shots.js 出力先` → 出力の boxes.json を `shots/<名前>.json` の形に直した）。
  AI の回答は架空の例
- `focus` を省いたスライド（スマートフォンの画面）は、枠を付けずに写真全体を見せる
- `node render.mjs` で `out/chishokan-ai.mp4` ができる。`public/manual/chishokan-ai.mp4`・`chishokan-ai-poster.jpg` に置き、`lib/manuals.ts` に足す
- 画面や作業が変わったら、マニュアルと一緒に写真・台本を直す
