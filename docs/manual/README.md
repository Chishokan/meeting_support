# 会議DX 操作マニュアル

全職員向けの操作マニュアル（会議DX のメニュー画面・部門会議と、ヘルプデスクの要項QA・マニュアル・ご意見・不具合の報告）。v0.18.0 の画面で作成。
職員にはヘルプデスクの「マニュアル」タブ（/helpdesk/manual）で配る。配るファイルは `public/manual/`、並べ方は `lib/manuals.ts`。
`lib/manuals.ts` には分類（`category`）を必ず付ける（画面では分類ごとの目次と検索で探す。合う分類が無ければ `MANUAL_CATEGORIES` に足す）。

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


# 智翔館AI（試用版）利用マニュアル

全職員向けの智翔館AIの手引き（開き方・画面の見方、質問と回答、資料の渡し方、コンテキスト（右の欄）と会話の書き出し、よく使う作業、ファイルの保存先、不具合の報告・要望の送り方、よくある質問）。v1.2 の画面で作成（2026年11月）。

| ファイル | 中身 |
|---|---|
| `../../public/manual/chishokan-ai-manual-v1.16.0.pdf` | 配布用の PDF（A4・22ページ）。ダウンロード時の名前は `智翔館AI利用マニュアル_v1.16.0.pdf` |
| `chishokan-ai-manual.html` | 原稿（会議DX のマニュアルと同じ書式。PDF はここから作る） |
| `images/ai_*.png` | 画面の写真（赤枠・番号つき） |
| `chishokan-ai/shots.js` | 写真を撮るスクリプト。アプリを手元で起動し（`CHISHOKAN_AI_MEMBERS='*' npx next start -p 3124`）、AI の回答は架空の例に差し替えて撮る。右の欄（コンテキスト）は横に広い画面（1366px）で撮る |
| `chishokan-ai/annotate.py` | 撮った写真に赤枠と番号を付け、余白を切る（`python3 annotate.py 撮った写真のフォルダ docs/manual/images`） |
| `chishokan-ai/pdf.js` | 原稿の HTML を A4 の PDF にする（`node pdf.js 原稿の絶対パス 出力.pdf`） |

- 写真の名前・会話・リンクは架空の例（有給休暇の回答だけは、ナレッジの就業規則の実際の条文）。本番のスプレッドシート・ドライブには何も書き込んでいない
- 画面の文言・ボタン・作業を変えたら、原稿と写真を直し、PDF を作り直して `lib/manuals.ts` の版・ファイル名を直す


# 成績管理 生徒の追加 マニュアル（v1.1.0）

受験票を作るために、成績管理（本番レベル模試）の名簿に生徒を足す方法だけをまとめた手引き（受験番号のきまり、［＋ 生徒を追加］での
1人ずつの追加、受験票の印刷、困ったとき）。成績管理を使う職員（小中等部、総務・人事・支援・管理）向け。2026年11月の画面で作成。
県一斉模試を受けた生徒の名簿は管理部門が入れるので、県一斉模試の名簿の取り込み（CSV）は入れていない（v1.1.0 で外した）。

| ファイル | 中身 |
|---|---|
| `../../public/manual/seiseki-student-manual-v1.1.0.pdf` | 配布用の PDF（A4・7ページ）。ダウンロード時の名前は `成績管理_生徒の追加マニュアル_v1.1.0.pdf` |
| `seiseki-student-manual.html` | 原稿（ログインのマニュアルと同じ書式。PDF はここから作る） |
| `images/seiseki_*.png` | 画面の写真（赤枠・番号つき） |
| `seiseki/shots.js` | 写真を撮るスクリプト（`node docs/manual/seiseki/shots.js 出力フォルダ http://localhost:3125`）。手元のアプリの `.data/moshi.json` に架空の回（時間割の時刻も）と名簿（日野校 0001〜0005）を入れておく。職員は架空（智翔 花子・小中等部）のログインにする |
| `seiseki/annotate.py` | 撮った写真に赤枠と番号を付け、余白を切る（`python3 docs/manual/seiseki/annotate.py 撮った写真のフォルダ docs/manual/images`） |
| `seiseki/pdf.js` | 原稿の HTML を A4 の PDF にする（`node docs/manual/seiseki/pdf.js 原稿の絶対パス 出力.pdf`） |

- 写真の生徒・職員の氏名は架空。本番のスプレッドシートには何も書き込んでいない
- 小中等部の職員として撮るため、手元の写しだけ `lib/moshi/access.ts` の MOSHI_DEPTS に小中等部を足して撮った
- ［＋ 生徒を追加］の受験番号のきまり（300番台）・画面の文言・ボタンを変えたら、原稿と写真を直し、PDF を作り直して `lib/manuals.ts` の版・ファイル名を直す

# 成績管理 成績入力 マニュアル（v1.1.0）

本番レベル模試の得点の入れ方をまとめた手引き（画面の見方、画面で大問ごとに入れる・教科を絞る・途中と赤いセル・Excel からの貼り付け、
入力シート（CSV）の書き出し・Excel での入れ方・取り込みと確認の画面、受験しない生徒、困ったとき）。得点を入れる職員向け。v1.24.0 の画面で作成し、v1.1.0 で［貼り付けで取り込む］をなくしたボタンの並び（名簿・書き出し・取り込み）に直した（2026年11月）。
生徒の足し方は「生徒の追加 マニュアル」に任せ、ここでは触れない。

| ファイル | 中身 |
|---|---|
| `../../public/manual/seiseki-entry-manual-v1.1.0.pdf` | 配布用の PDF（A4・13ページ）。ダウンロード時の名前は `成績管理_成績入力マニュアル_v1.1.0.pdf` |
| `seiseki-entry-manual.html` | 原稿（生徒の追加 マニュアルと同じ書式。PDF はここから作る） |
| `images/seiseki_in_*.png` | 画面の写真（赤枠・番号つき） |
| `seiseki/entry-seed.mjs` | 写真用の架空のデータ（回＝2026 本番レベル模試 11月、日野校 0001〜0008 の架空の生徒と途中までの得点）を `.data/moshi.json` に作る（`node --experimental-strip-types docs/manual/seiseki/entry-seed.mjs`） |
| `seiseki/entry-shots.js` | 写真を撮るスクリプト。成績管理の保存先を設定せずにアプリを手元で起動し（`npx next dev -p 3125`）、`node docs/manual/seiseki/entry-shots.js 出力フォルダ http://localhost:3125`。写真の中で得点を入れ、書き出した CSV に社会の得点を足して取り込むので、撮り直すときは entry-seed.mjs からやり直す |
| `seiseki/entry-annotate.py` | 撮った写真に赤枠と番号を付ける（`python3 docs/manual/seiseki/entry-annotate.py 撮った写真のフォルダ docs/manual/images`。切り取りは撮るときに済ませている） |
| `seiseki/pdf.js` | 原稿の HTML を A4 の PDF にする（`node docs/manual/seiseki/pdf.js 原稿の絶対パス 出力.pdf '成績管理 成績入力 マニュアル'`） |

- 写真の生徒・職員の氏名と得点は架空。本番のスプレッドシートには何も書き込んでいない
- 成績入力の画面の文言・ボタン（色・並び）、入力シートの列、取り込みの確認の文言を変えたら、原稿と写真を直し、PDF を作り直して `lib/manuals.ts` の版・ファイル名を直す
- 動画版（15枚・3分半ほど。ナレーションは音読さん）の台本・写真・作り方は `video/seiseki-entry/`（写真はこのスクリプトの出力から作る）

# イベント申込管理 教室担当者マニュアル（v1.0.0）

イベント申込管理（/event）の声掛け名簿の使い方をまとめた手引き（名簿の見方と「次にすること」、スイッチでの記録と保存の見方、一括で記録、
絞り込みと並び順、申込の状況と名簿外の申込、名簿にいない生徒の追加、困ったとき）。教室担当の職員（小中等部・RED個別・高等部）向け。
v1.13.0（2026年11月）の画面で作成。管理部門だけに出る「校舎ごとの進み具合」は入れていない。

| ファイル | 中身 |
|---|---|
| `../../public/manual/event-list-manual-v1.0.0.pdf` | 配布用の PDF（A4・15ページ）。ダウンロード時の名前は `イベント申込管理_教室担当者マニュアル_v1.0.0.pdf` |
| `event-list-manual.html` | 原稿（成績管理のマニュアルと同じ書式。PDF はここから作る） |
| `images/event_*.png` | 画面の写真（赤枠・番号つき） |
| `event/data.json` | 写真用の架空のデータ（名簿・声掛けの記録・フォームの回答）。手元のアプリの `.data/event.json` に写して撮る |
| `event/shots.js` | 写真を撮るスクリプト（`node docs/manual/event/shots.js docs/manual/images http://localhost:3126`）。赤枠と番号は、撮る前に画面の上に重ねて描く（annotate.py は使わない）。保存中の写真は、保存の返事を遅らせて撮る |
| `event/pdf.js` | 原稿の HTML を A4 の PDF にする（`node docs/manual/event/pdf.js 原稿の絶対パス 出力.pdf`） |

- 写真の生徒・職員（智翔 花子・小中等部）の氏名、記録、フォームの回答は架空。本番のスプレッドシートには何も書き込んでいない
- 撮り直すたびに `.data/event.json` を `event/data.json` で上書きする（撮影の途中で記録を付けるため）
- 画面の文言・ボタン・「次にすること」の文（`lib/eventList/model.ts` の todoOf）・絞り込みや並び順の選択肢を変えたら、原稿と写真を直し、
  PDF を作り直して `lib/manuals.ts` の版・ファイル名・ページ数を直す
- 次のイベントで使い回すときは、表紙の「いまのイベント」と、写真の見出し（イベント名・日付）を直す
- 動画「イベント申込管理 声掛け名簿の使い方」（配布は `public/manual/event-list.mp4`・`event-list-poster.jpg`。ナレーションは音読さん）の台本・画面写真・
  作り方は `video/event-list/`。ナレーションは、音読さんで作った mp3 を `video/event-list/audio/` に置いてから作り直す

# 動画「成績管理 生徒の追加」（作成中）

上のマニュアルの動画版（12枚・ナレーションは音読さん）。作り方は `video/seiseki-student/README.md`。
音声が入るまでは配っていない（`public/manual/` と `lib/manuals.ts` にはまだ無い）。

