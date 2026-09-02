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
- ここを直すと全社員の AI に一括反映

## ログ / セキュリティ（テスト版のため要ハードニング）
- 会話は Vercel のログに [CHAT_LOG] として出力。durable 保存は lib/log.ts で DB 追加。
- 認証は簡易版（氏名＋校舎＋合言葉）。本番は Google SSO 等へ。
- ログを人事評価に使う場合は社員への周知・同意を。API キーはサーバ環境変数のみ。
