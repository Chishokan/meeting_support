# Supabase（データベース）

智翔館アプリ群のデータを、Google スプレッドシート（Apps Script 経由）から Supabase に順番に移していく。
スプレッドシートは1回の読み書きに1〜3秒かかるが、Supabase は数十ミリ秒で済む。

| アプリ | 状態 |
|---|---|
| 門配管理 | `migrations/0001_monpai.sql`（v0.5.0〜） |
| 問合せ管理 | 未移行（Apps Script） |
| 会議DX | 未移行（Apps Script） |

## プロジェクトの作り方（本番用と dev 用で2つ作る）

1. Supabase で New project を作る
   - 名前の例：`chishokan-dev`、`chishokan-prod`
   - **Region は Northeast Asia (Tokyo)** にする（Vercel の関数も東京 hnd1 に置いている）
   - Database Password は控えておく（アプリでは使わない）
2. 左メニューの **SQL Editor** を開き、`migrations/` の SQL を番号順に貼り付けて Run する
   - 何度実行しても壊れないように書いてある
3. **Project Settings → API Keys** で次の2つを控える
   - Project URL（`https://xxxx.supabase.co`）
   - `service_role`（secret）キー ※ **絶対にブラウザや画面に出さない・人に送らない**
4. Vercel の Environment Variables に登録して再デプロイする
   - `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY`（Secret）
   - dev 用のプロジェクトの値は **Preview と Development**、本番用は **Production**

登録すると、門配管理はスプレッドシートではなく Supabase を読み書きするようになる。
環境変数を外せば、スプレッドシート（MONPAI_SCRIPT_URL）に戻る。

## 守ること

- 全テーブルで RLS を有効にし、ポリシーは作らない。読み書きはアプリのサーバが service_role キーで行う
- 生徒・保護者の個人情報を扱うテーブルを作るときは、列の必要性を見直し、不要な項目は持たない
- テーブルや列を変えるときは、新しい番号の SQL ファイルを足す（既存のファイルは書き換えない）
