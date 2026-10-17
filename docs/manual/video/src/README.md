# 動画「部門会議の進め方」の作り方

手順1 事前共有 → 手順2 録音 → 手順3 議事録 → 手順4 次回の事前共有 を、画面写真に強調の枠と字幕をのせた
スライド動画（1920×1080）にする。ナレーションは Gemini の音声合成（TTS）で作る。

| ファイル | 中身 |
|---|---|
| `storyboard.mjs` | 台本。スライド1枚ごとの字幕（title / body …）と読み上げ原稿（say） |
| `slides.html` | スライドの見た目。外から `show(i, t)` で i 枚目の t 秒の状態にする |
| `shots/` | 赤枠なしの画面写真（2倍の解像度）と、強調する枠の位置（CSS px の JSON） |
| `tts.mjs` | `say` を Gemini で読み上げ、`audio/<id>.wav` にする |
| `render.mjs` | コマ撮りして `out/dept-meeting.mp4` と `out/poster.jpg` を作る |

`audio/` `out/` `frames/` `data.js` は作業用（git に入れない）。

## ナレーション入りの動画を作る

1. Gemini の API キーを、クラウド環境の設定で環境変数 `GEMINI_API_KEY` に入れる
   （別の Google アカウントのキーがあれば `GEMINI_API_KEY_2` にも。無料枠が2倍になる）。
   設定は新しいセッションから効く
2. 読み上げを作る

   ```sh
   cd docs/manual/video/src
   node tts.mjs
   ```

   - 21枚を1枚ずつ読み上げ、聞き取り確認（作った音声を文字起こしして原稿と比べる）までする
   - 無料枠に合わせて、キー1本あたり1分に3回の間隔で送る（`GEMINI_TTS_RPM` で変えられる）。21枚で10分ほど
   - 「1日の枠を使い切り」で止まったら、翌日にもう一度 `node tts.mjs` を実行すれば続きから作る
   - 最後に「聞き取り確認で食い違いが残っています」と出たスライドは、`audio/<id>.json` の `heard`
     （実際にどう読まれたか）を見て、`storyboard.mjs` の `say` を読み方で書き直し、もう一度 `node tts.mjs`
   - 声は `GEMINI_TTS_VOICE`（既定 Kore）、モデルは `GEMINI_TTS_MODEL`（未設定ならモデル一覧から自動で選ぶ）
3. 動画を作る

   ```sh
   node render.mjs            # ナレーションの長さに合わせて各スライドの表示時間が決まる（4分前後）
   node render.mjs --silent   # ナレーションなし（字幕だけ）
   ```

4. できた `out/dept-meeting.mp4` と `out/poster.jpg` を `docs/manual/video/` に上書きし、
   操作マニュアルの Web 版（`docs/manual/meeting-dx-manual.html` を Artifact として公開しているページ）を公開し直す

## 直すとき

- 字幕や読み上げを直す：`storyboard.mjs` だけを直す。`say` を変えたスライドの音声は、次の `node tts.mjs` で作り直される
  （原稿が変わったスライドの古い音声は `render.mjs` が使わない）
- 読み上げは記号・英字・日付で崩れやすいので、`say` は読み方で書く（例：「AI」→「エーアイ」、「会議DX」→「会議ディーエックス」）
- 画面が変わったら写真を撮り直す。`shots/<名前>.json` の `boxes` は、写真の中で強調する枠（`n` が台本の `focus` の番号）
