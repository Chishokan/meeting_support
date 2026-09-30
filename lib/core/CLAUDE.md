# lib/core/ ─ 智翔館アプリ群の共通基盤

会議DX・問合せ管理・門配管理など、すべての業務アプリが使う部品だけを置く。
ここを直すと全アプリに影響するので、変更は develop（dev 環境）で確認してから本番に出す。

| ファイル | 役割 |
|---|---|
| `auth.ts` | ログインのセッション（署名付き Cookie）。全アプリ共通の1回ログイン。画面は `requireSession()` で守る |
| `users.ts` | ログインアカウント（Supabase の `app_users`）。パスワードの照合・発行・再発行・変更用URLのトークン |
| `roles.ts` | ロール（admin／staff＝教室長／employee＝社員／teacher＝講師）と担当教室の選択肢 |
| `mail.ts` | アカウント発行・再発行の案内メール（Apps Script の sendMail 経由） |
| `staff.ts` | 部門（事業部）の一覧と管理部門の定義。担当者名は会議DXの文字起こし・門配の担当候補に使う |
| `companyKnowledge.ts` | 会社の前提知識をAIへ差し込む。本文は `knowledge/10_理念・方針/COMPANY.md`。日付・期の計算もここ |
| `knowledgeDocs.ts` | `knowledge/` 配下の Markdown（確定した要項など）を読む |
| `sanitize.ts` | AIの応答の後処理（役割漏れの除去など） |
| `log.ts` | AIとの会話ログをスプレッドシートへ転記する |

## 置き場所の決め方

- **2つ以上のアプリで使うもの** → `lib/core/`
- **1つのアプリだけで使うもの** → `lib/` 直下（今後はアプリごとのフォルダ `lib/<アプリ名>/` に分ける）
- `lib/core/` から各アプリのファイルを import しない（共通基盤がアプリに依存すると、切り離せなくなる）
