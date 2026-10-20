# 会議DX 操作マニュアル

全職員向けの操作マニュアル（会議DX のメニュー画面・部門会議と、ヘルプデスクの要項QA・マニュアル・ご意見・不具合の報告）。v0.18.0 の画面で作成。
職員にはヘルプデスクの「マニュアル」タブ（/helpdesk/manual）で配る。配るファイルは `public/manual/`、並べ方は `lib/manuals.ts`。

| ファイル | 中身 |
|---|---|
| `../../public/manual/meeting-dx-manual-v0.18.0.pdf` | 配布用の PDF（A4・29ページ）。ダウンロード時の名前は `会議DX操作マニュアル_v0.18.0.pdf` |
| `meeting-dx-manual.html` | マニュアルの原稿（本文だけの HTML。PDF はここから作る） |
| `images/` | 画面の写真（赤枠・番号つき） |
| `../../public/manual/dept-meeting.mp4` | 動画マニュアル「部門会議の進め方」（約5分・1920×1080・字幕と Gemini のナレーション）。手順1 事前共有〜手順4 次回の事前共有 |
| `../../public/manual/dept-meeting-poster.jpg` | 動画の表紙（再生前に出る画像） |
| `video/src/` | 動画の台本・読み上げ原稿・作成スクリプト（作り方は `video/src/README.md`） |

- 写真の会議名・人名・数値は架空の例。アプリを手元で起動し、API の応答を架空データに差し替えて撮影した
  （本番のスプレッドシートには何も書き込んでいない）。要項QA の要項カードだけは `knowledge/40_要項/` の実際の要項
- 動画は、赤枠なしで撮った画面写真に、強調の枠と字幕をのせたスライドをコマ撮りして作った（Web版のマニュアルでは第2章の冒頭で再生できる）
- 原稿の HTML は claude.ai の Web 版（Artifact）としても公開している。そのときは動画を `video/dept-meeting.mp4`・`video/poster.jpg`
  として一緒に載せる（原稿の中の動画のパスはこの名前）
- 作り直したら：PDF を `public/manual/` に置き（版をファイル名に入れる）、古い PDF を消し、`lib/manuals.ts` の `href`・`downloadName`・`meta` を直す
- 画面の文言・ボタン名を変えたら、このマニュアルの該当箇所と写真・動画も直す
  - 第2章の「かかる時間の目安」は、文字起こしの区間の長さ（`lib/audioChunk.ts` の `SEGMENT_SECONDS`）と
    送信間隔（環境変数 `GEMINI_RPM`・APIキーの本数）から出している。これらを変えたら表も見直す
