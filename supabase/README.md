# Supabase（データベース）

智翔館アプリ群のデータを、Google スプレッドシート（Apps Script 経由）から Supabase に順番に移していく。
スプレッドシートは1回の読み書きに1〜3秒かかるが、Supabase は数十ミリ秒で済む。

| アプリ | 状態 |
|---|---|
| 門配管理 | `migrations/0001_monpai.sql`（v0.6.0〜） |
| ログインアカウント | `migrations/0002_app_users.sql`（v1.0.0〜）。Supabase が無いとログインできない |
| 問合せ管理 | 未移行（Apps Script） |
| 会議DX | 未移行（Apps Script） |

## 設定の手順（既存のプロジェクトに同居させる）

無料プランはプロジェクト数に上限があるため、既存のプロジェクトの中に**区画（スキーマ）**を2つ作り、
dev 用＝`chishokan_dev`、本番用＝`chishokan_prod` に分けて置く。既存のアプリのテーブルとは混ざらない。

1. 既存のプロジェクトの **Region** を確認する（Project Settings → General）。Tokyo 以外だと速さの効果が薄れる
2. **SQL Editor** で `migrations/` の SQL を番号順に実行する
   - まずそのまま実行（`chishokan_dev` にできる）
   - 次に、先頭の2行の `chishokan_dev` を `chishokan_prod` に書き換えてもう一度実行
3. **Project Settings → Data API（API）→ Exposed schemas** に `chishokan_dev` と `chishokan_prod` を追加して保存
   - これをしないとアプリから読めない（エラーになる）
   - 権限は service_role にだけ渡しているので、公開用のキー（anon）では読めない
4. **Project Settings → API Keys** で Project URL と `service_role`（secret）キーを控える
   ※ **絶対にブラウザや画面に出さない・人に送らない**
5. Vercel の Environment Variables に登録して再デプロイする

| 変数 | Preview・Development（dev） | Production（本番） |
|---|---|---|
| `SUPABASE_URL` | Project URL | 同じ |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role キー（Secret） | 同じ |
| `SUPABASE_SCHEMA` | `chishokan_dev` | `chishokan_prod` |

登録すると、門配管理はスプレッドシートではなく Supabase を読み書きするようになる。
環境変数を外せば、スプレッドシート（MONPAI_SCRIPT_URL）に戻る。

## 同居させるときの注意

- service_role キーはプロジェクト全体（既存のアプリのデータも含む）に効く。扱いはこれまで以上に慎重に
- 無料プランは、**7日間アクセスが無いとプロジェクトが一時停止**する（毎日使っていれば止まらない）。
  自動バックアップも無い。問合せ管理など個人情報や業務の正本を移す前に、有料プラン（Pro）を検討する
- 容量（無料は 500MB）を既存のアプリと分け合う

## 守ること

- 全テーブルで RLS を有効にし、ポリシーは作らない。読み書きはアプリのサーバが service_role キーで行う
- 生徒・保護者の個人情報を扱うテーブルを作るときは、列の必要性を見直し、不要な項目は持たない
- テーブルや列を変えるときは、新しい番号の SQL ファイルを足す（既存のファイルは書き換えない）
