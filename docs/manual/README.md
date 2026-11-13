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

# ログイン 利用マニュアル・共通ログイン 利用マニュアル（v1.0.0）

- `login-basic-manual.html` → `public/manual/login-basic-manual-v1.0.0.pdf`（9ページ）：社員全員向け。ログインのしかたとパスワードの決め方だけ
- `login-manual.html` → `public/manual/login-manual-v1.0.0.pdf`（11ページ）：給与アプリも使う方向け。メールアドレスとパスワードでのログイン、はじめにパスワードを決める手順（初回設定・再設定）、給与アプリとの行き来、困ったときの対処。

| ファイル | 中身 |
|---|---|
| `../../public/manual/login-manual-v1.0.0.pdf` | 配布用の PDF（A4・11ページ）。ダウンロード時の名前は `共通ログイン利用マニュアル_v1.0.0.pdf` |
| `login-manual.html` | 原稿（会議DX のマニュアルと同じ見た目。PDF はここから Chromium の印刷で作る） |
| `images/login/` | 画面の写真 |

- 写真は、智翔館アプリと給与アプリ（Color）を手元で起動し、手元の試験用DBに架空の職員（智翔 太郎・taro@example.com）を作って撮った
- 給与アプリ側の写真のロゴは、手元では本物のロゴ画像を読めないため、画面の写真から切り出した画像で代用した
- 画面の文言を変えたら（ログイン画面・パスワード設定・エラーの文言）、第2章・第5章の表も直す
- 動画「共通ログインの使い方」（約3分。配布は `public/manual/login.mp4`・`login-poster.jpg`）の台本・画面写真・作り方は `video/login/`（ナレーションは音読さんで作った mp3 を `video/login/audio/` に置いている）
