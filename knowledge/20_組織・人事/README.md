# 20_組織・人事

組織図・職務分掌など。現在あるのは **講師一覧（Color HRM から取り込み）** のみ。

## 講師一覧.md（Color HRM → git）

講師マスタの正本は Color HRM（https://chishokan.co.jp/colorhrm/ ・Xサーバー上の MySQL）。
会議DXアプリは DB を直接読まず、ここに置いた Markdown の写しを読む。

**このファイルは `scripts/import-instructors.mjs` が生成する。手で直さない。**
直したいときは Color HRM 側を直し、取り込み直す。

### 更新手順（総務・人事の admin が行う）

1. Color HRM に admin でログイン → 「講師情報 CSVエクスポート」で CSV をダウンロード
2. `node scripts/import-instructors.mjs <ダウンロードした staff_YYYYMMDD.csv>`
3. `git diff` で増減を確認して commit & push（Vercel が再デプロイ）
4. **ダウンロードした CSV を削除する**（ログイン用の平文パスワードが入っている。`staff_*.csv` は .gitignore 済みだが、PC にも残さない）

### 入っているもの・入れないもの

| 入っている | 入れない（取り込み時に落とす） |
|---|---|
| 氏名・社員コード・部門・校舎・雇用形態・カラー | メール・ログイン情報・パスワード |
| 在籍中の講師のみ | 退職者 |
| | 入社日・メンター・紹介者・応募媒体・育成目標（人事評価に近いため） |
| | 給与・シフト・打刻（Color HRM 給与側のデータ） |

「入れない」ものを足したくなったら、git の履歴から消せないことを思い出すこと（`00_index/README.md` の「入れてはいけないもの」）。

### 誰が読むか

| 機能 | 使い方 | コード |
|---|---|---|
| 全AI機能の前提知識 | 校舎ごとの講師名・部門・カラーを載せる | `lib/companyKnowledge.ts`（`withCompanyKnowledge`） |
| 部門会議議事録 | 講師名の表記を揃える／生徒名との区別 | `lib/deptMinutesPrompt.ts` |
| 音声の文字起こし | 講師名を固有名詞のヒントとして渡す | `lib/transcribeVocab.ts` |

読み込みは `lib/instructors.ts`。ファイルが無いときは「一覧なし」として動く（アプリは壊れない）。
置き場所を変えたら `next.config.mjs` の `outputFileTracingIncludes` も直すこと。
