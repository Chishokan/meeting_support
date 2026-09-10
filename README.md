# 智翔館 週間計画アシスタント（テスト版）

社内向けの Web チャットアプリ。ログインした社員が Claude API と会話しながら週間の行動計画を作る。
会話ログを記録（後の改善・人事評価用）、API キーはサーバ側のみ。

## ローカル起動
1. npm install
2. cp .env.example .env.local して ANTHROPIC_API_KEY と ACCESS_CODE を設定
3. npm run dev → http://localhost:3000

## Vercel デプロイ
1. このリポジトリを Vercel で Import
2. 環境変数を設定: ANTHROPIC_API_KEY / ACCESS_CODE /（任意）AGENT_MODEL
3. Deploy → 発行 URL を社内共有

## 中身の調整
- 会社情報・理念・社長方針: lib/companyKnowledge.ts
- 会話の進め方（プロンプト）: lib/systemPrompt.ts（会議AI「事前報告」モード）
- 夏の数値報告（「数値報告」メニューの入力項目・校舎のプルダウン）: lib/summerNumbers.ts
  - 校舎の選択肢は CAMPUSES に並べる（空のままなら校舎名は自由入力欄になる）
  - 入力は スプレッドシート「夏期数値」へ1行ずつ記録（apps_script/Code.gs の saveNumbers_ / listNumbers_）
- 夏の結果報告（会議AI「夏の結果報告」モード）: lib/summerPrompt.ts
  - 数値は対話で尋ねず、「数値報告」で登録済みのものを読み取る。未登録なら入力を促して止まる
  - 募集／継続／成績を「今年・昨年・目標」で振り返り、その他振り返り・成功事例・共有/相談したいことを出力
  - 「報告」でドキュメントへ転記すると、報告文中の「■ 成功事例（全体共有）」を
    スプレッドシート「成功事例」へ自動で1件1行記録し、ダッシュボードに全部門分を表示
    （抽出ロジック: lib/successCases.ts ／ 保存先: apps_script/Code.gs の saveSuccess_ / listSuccess_）
- 部門会議議事録（「部門会議議事録」メニュー）
  - 流れ：会議情報を入力 →（録音／録音ファイル添付／文字起こし貼り付け）→ AIが議事録化 →
    入力者が確認・修正 → 保存 → 決定事項が全部門で見える
  - 議事録テンプレート（項目・書き方）: lib/deptMinutesTemplate.ts ★ここを直せば AI の出力・
    画面のヘルプ・会議の質チェックにまとめて反映される
  - AI への指示: lib/deptMinutesPrompt.ts
  - 保存先: 「部門会議議事録」シート（1会議1行）＋「部門決定事項」シート（1決定1行）
    （apps_script/Code.gs の saveDeptMinutes_ / listDeptMinutes_ / listDeptDecisions_）
  - テンプレートに沿わなかった点（話し合えなかった議題・結論の出なかった議題・担当や期限が
    決まっていない決定など）は「会議の質チェック」として議事録の後ろに出力され、シートにも残る
- ここを直すと全社員の AI に一括反映

## 音声の文字起こしについて（部門会議議事録）
Claude は音声を直接読めないため、文字起こしだけ外部の音声認識サービスを使う。
OpenAI 互換の `/v1/audio/transcriptions` を持つサービスならどれでも接続できる。

1. サービス（OpenAI / Groq / Azure OpenAI / 自前の faster-whisper 等）で API キーを発行
2. Vercel の環境変数に設定：`SPEECH_API_KEY`（必須）／`SPEECH_API_URL`・`SPEECH_MODEL`・
   `SPEECH_LANGUAGE`（既定値のままでよければ不要）
3. 未設定のままでもアプリは壊れない。画面が「音声の自動文字起こしは未設定」と表示し、
   他アプリで文字起こししたテキストの貼り付けだけが使える状態になる

長い会議はブラウザ側で自動的に分割して送る（録音は2分ごと、添付ファイルは16kHzモノラルWAVの90秒ごと）。
サーバ関数の実行時間・リクエストサイズの上限に収めるための分割なので、
区間の長さを変えるときは components/DeptMinutesUI.tsx と lib/audioChunk.ts の両方を確認すること。

## ログ / セキュリティ（テスト版のため要ハードニング）
- 会話は Vercel のログに [CHAT_LOG] として出力。durable 保存は lib/log.ts で DB 追加。
- 認証は簡易版（氏名＋校舎＋合言葉）。本番は Google SSO 等へ。
- ログを人事評価に使う場合は社員への周知・同意を。API キーはサーバ環境変数のみ。
