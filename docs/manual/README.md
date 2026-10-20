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

## 門配管理 操作マニュアル

門配管理（月間一覧・AIの計画案・実績報告・集計・配布物・学校マスタ）の使い方。v0.18.0 の画面で作成。会議DXのマニュアルと同じ形式（見た目の CSS も同じ）。

| ファイル | 中身 |
|---|---|
| `../../public/manual/monpai-manual-v0.18.0.pdf` | 配布用の PDF（A4・17ページ）。ダウンロード時の名前は `門配管理操作マニュアル_v0.18.0.pdf` |
| `monpai-manual.html` | マニュアルの原稿（PDF はここから作る） |
| `images/50_mp_*.png` 〜 `images/59_mp_*.png` | 画面の写真（赤枠・番号つき） |
| `monpai-shots/` | 架空データ・撮影・PDF 作成のスクリプト（作り方は下） |

- 写真の担当者名・部数・在庫は架空の例。学校名と生徒数は `lib/monpai/seed.ts` の初期値。AIの計画案は撮影用に作った応答を返している
- 作り直し方（手元で、Supabase の環境変数なしで起動する。門配は `.data/monpai.json` に保存される）

  ```sh
  node docs/manual/monpai-shots/gen.mjs .data/monpai.json   # 架空データを入れる（今ある .data/monpai.json は上書きされる）
  npx next dev -p 3100                                      # 別のターミナルで起動しておく
  node docs/manual/monpai-shots/shoot.mjs docs/manual/images
  node docs/manual/monpai-shots/pdf.mjs "$PWD/docs/manual/monpai-manual.html" "$PWD/public/manual/monpai-manual-v0.18.0.pdf"
  ```

  - データの日付は 2026年9〜10月で、撮影は「今日＝2026-10-20」を前提にしている（別の日に撮るなら `gen.mjs` の日付をずらす）
  - 撮影では開発環境の帯を隠し、Noto Sans JP の字体と日本語の日付表示（`LANG=ja_JP.UTF-8`）にしている
- 作り直したら、PDF の版をファイル名に入れて古い PDF を消し、`lib/manuals.ts` の `monpai` の `href`・`downloadName`・`meta` を直す
