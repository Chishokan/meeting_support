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
- 会話の進め方（プロンプト）: lib/systemPrompt.ts
- ここを直すと全社員の AI に一括反映

## ログ / セキュリティ（テスト版のため要ハードニング）
- 会話は Vercel のログに [CHAT_LOG] として出力。durable 保存は lib/log.ts で DB 追加。
- 認証は簡易版（氏名＋校舎＋合言葉）。本番は Google SSO 等へ。
- ログを人事評価に使う場合は社員への周知・同意を。API キーはサーバ環境変数のみ。
