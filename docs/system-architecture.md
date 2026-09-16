# 智翔館 会議DX ─ システム構成図・ER図（現状）

2026年9月時点のコードから起こした「いま動いている構成」の図。
設計案ではなく現状の写しなので、機能を足したり保存先を変えたりしたら、この図も直すこと。

- 図は Mermaid で書いてある。GitHub 上でそのまま描画される
- 対応するコードの場所を各所に添えた。図と食い違ったらコードが正

---

## 1. システム構成図

### 1-1. 全体像

```mermaid
flowchart LR
  subgraph client["利用者のブラウザ（社員）"]
    UI["Next.js 画面（React）<br/>ダッシュボード / 会議AI / 数値報告 / 部門会議議事録<br/>全体会議振り返り / 中間報告 / 報告<br/>問い合わせQA / 要項QA / お問い合わせ"]
    LS[("localStorage<br/>会話履歴・議事録ドラフト<br/>（端末内のみ）")]
    REC["録音・音声ファイル<br/>→ 16kHz モノラル WAV に変換<br/>lib/audioChunk.ts"]
    UI --- LS
    UI --- REC
  end

  subgraph vercel["Vercel（Next.js 14 App Router / Node ランタイム）"]
    AUTH["簡易認証<br/>/api/login・/api/logout<br/>職員マスタ lib/staff.ts<br/>Cookie セッション lib/auth.ts"]
    API_AI["AI 系 Route Handler（ストリーミング）<br/>/api/chat（会議AI）<br/>/api/progress（中間報告）<br/>/api/dept-minutes（議事録化）<br/>/api/inquiry-qa（問い合わせQA）<br/>/api/yoko-qa（要項QA）<br/>/api/minutes（準備中）"]
    API_DATA["データ系 Route Handler<br/>/api/report /api/progress/submit<br/>/api/numbers /api/success /api/inquiry<br/>/api/meeting-review /api/progress/items<br/>/api/progress/latest /api/dept-minutes/save<br/>/api/dept-minutes/list"]
    TR["/api/dept-minutes/transcribe<br/>（90秒区間ごと・multipart）"]
    PROMPT["プロンプト組立<br/>lib/companyKnowledge.ts（共通前提）<br/>＋ 機能別 *Prompt.ts"]
    KN[("knowledge/<br/>40_要項/*.md（front matter 付き）<br/>00_index/GLOSSARY.md<br/>ビルドに同梱・実行時に fs で読む")]
    LOG["lib/log.ts<br/>Vercel Logs に [CHAT_LOG]"]
  end

  subgraph ai["外部 AI サービス"]
    CLAUDE["Anthropic Claude API<br/>claude-sonnet-5（AGENT_MODEL で変更可）<br/>messages.stream・プロンプトキャッシュ"]
    GEMINI["Google AI Studio（Gemini API）<br/>gemini-3.6-flash<br/>音声の文字起こしだけを担当"]
  end

  subgraph google["Google Workspace"]
    GAS["Apps Script Web アプリ<br/>apps_script/Code.gs<br/>POST JSON の action で振り分け<br/>token 検証"]
    SS[("会議DX スプレッドシート<br/>会話ログ / 議事録 / 部門会議議事録<br/>部門決定事項 / 中間報告状況 / 中間報告項目<br/>夏期数値 / 全体会議振り返り / 成功事例 / 問い合わせ")]
    DOC[("会議ドキュメント（Google ドキュメント）<br/>REPORT_DOC_ID<br/>部門ごとの事前報告タブ・中間報告タブ")]
    DRV[("Google ドライブ<br/>フォルダ「会議DX_お問い合わせ画像」")]
    INQ[("問合せ管理スプレッドシート<br/>INQUIRY_BOARD_ID・校舎別シート<br/>読み取り専用・個人情報はGAS側でマスク")]
    GOAL[("中等部会議議事録スプレッドシート<br/>GOALS_BOOK_ID・タブ「秋～冬行動計画」<br/>読み取り専用・タブ名で引く")]
  end

  UI -->|"氏名＋事業部"| AUTH
  UI -->|"HTTPS / fetch"| API_AI
  UI -->|"HTTPS / fetch"| API_DATA
  REC -->|"WAV 区間（約2.9MB）"| TR

  API_AI --> PROMPT
  PROMPT -->|"要項・用語を読む"| KN
  TR -->|"用語ヒント"| KN
  API_AI -->|"system + 履歴"| CLAUDE
  TR -->|"generateContent（音声 base64）"| GEMINI
  API_AI --> LOG

  API_DATA -->|"save* / append* / list*"| GAS
  API_AI -->|"listNumbers / listInquiryBoard<br/>listGoals / getProgressItems"| GAS
  LOG -->|"action:log"| GAS

  GAS -->|"1行ずつ追記・読み取り"| SS
  GAS -->|"appendReport / appendProgress"| DOC
  GAS -->|"画像を保存し URL を記録"| DRV
  GAS -->|"listInquiryBoard"| INQ
  GAS -->|"listGoals"| GOAL
```

要点:

| 層 | 役割 | 補足 |
|---|---|---|
| ブラウザ | 画面表示・録音・WAV 変換・会話履歴の一時保持 | 会話履歴とドラフトは localStorage。端末を変えると引き継がれない |
| Vercel（Next.js） | 認証、プロンプト組立、AI 呼び出し、Google への転記依頼 | API キーはすべてサーバ環境変数。ブラウザには渡らない |
| Claude API | 対話・議事録化・QA 回答 | 全機能で共通の会社前提（lib/companyKnowledge.ts）を先頭に置く |
| Gemini API | 音声の文字起こしのみ | Claude が音声を読めないため。未設定でも貼り付け運用で動く |
| Apps Script | Google 側の唯一の入口 | Next からは常に `APPS_SCRIPT_URL` へ POST。GAS が各シート・ドキュメントへ振り分ける |
| Google Sheets / Docs / Drive | 永続データ | RDB は無い。スプレッドシートの各シートが「テーブル」に相当する |
| knowledge/（git） | 確定済み要項・用語辞書 | Google ドキュメントを直接読まず、担当者が確認したものだけを git に置く |

### 1-2. 機能ごとの経路

```mermaid
flowchart TB
  subgraph f1["会議AI（事前報告・夏の結果報告）→ 報告"]
    direction LR
    a1["/chat 画面"] -->|"messages"| a2["/api/chat"]
    a2 -->|"summer モードは listNumbers で夏期数値を差し込む"| a3["Claude"]
    a3 -->|"報告文"| a1
    a1 -->|"貼り付け"| a4["/report 画面"]
    a4 --> a5["/api/report"]
    a5 -->|"appendReport"| a6["会議ドキュメント 部門タブ"]
    a5 -->|"■ 成功事例 を抽出 → saveSuccess"| a7["成功事例シート"]
  end

  subgraph f2["部門会議議事録"]
    direction LR
    b1["/dept-minutes 画面<br/>会議情報入力・録音"] -->|"WAV 90秒ごと"| b2["/api/dept-minutes/transcribe"]
    b2 --> b3["Gemini"]
    b3 -->|"文字起こし"| b1
    b1 -->|"transcript + meta"| b4["/api/dept-minutes"]
    b4 --> b5["Claude（テンプレート準拠）"]
    b5 -->|"議事録ドラフト＋会議の質チェック"| b1
    b1 -->|"人が確認・修正して保存"| b6["/api/dept-minutes/save"]
    b6 -->|"決定事項を抽出<br/>saveDeptMinutes"| b7["部門会議議事録シート（1会議1行）<br/>部門決定事項シート（1決定1行）"]
  end

  subgraph f3["中間報告"]
    direction LR
    c1["/progress 画面"] --> c2["/api/progress"]
    c2 -->|"getProgressItems で部門の定例項目を取得"| c3["Claude"]
    c3 -->|"中間報告文"| c1
    c1 --> c4["/api/progress/submit"]
    c4 -->|"appendProgress"| c5["会議ドキュメント 中間報告タブ<br/>＋ 中間報告状況シート"]
    c6["/progress/settings（管理部門のみ）"] -->|"saveProgressItems"| c7["中間報告項目シート"]
  end

  subgraph f4["問い合わせQA（小中等部・管理部門のみ）"]
    direction LR
    d1["/inquiry-qa 画面"] --> d2["/api/inquiry-qa"]
    d2 -->|"listInquiryBoard（マスク済み）"| d3["問合せ管理スプレッドシート"]
    d2 -->|"listGoals"| d4["秋～冬行動計画タブ"]
    d2 -->|"集計値を『正』として渡す"| d5["Claude"]
  end

  subgraph f5["要項QA（全部門）"]
    direction LR
    e1["/yoko-qa 画面"] --> e2["/api/yoko-qa"]
    e2 -->|"status: 確定 のみ全文"| e3["knowledge/40_要項/*.md"]
    e2 --> e4["Claude"]
  end
```

### 1-3. 運用・デプロイの流れ

```mermaid
flowchart LR
  DEV["開発者<br/>git push"] --> GH["GitHub<br/>chishokan/meeting_support"]
  GH -->|"自動デプロイ"| VC["Vercel 本番"]
  GDOC["要項ドキュメント<br/>（Google ドキュメント）<br/>担当者がステータスを「確定」に"] -->|"Drive API で Markdown 書き出し<br/>（毎日 03:00 JST / GAS 検知で即時）"| ACT["GitHub Actions sync-yoko<br/>import-yoko.mjs --sync<br/>check-yoko.mjs --confirmed"]
  ACT -->|"PR sync/yoko"| REV["総務が差分を確認してマージ"]
  REV --> GH
  GASY["apps_script/YokoSync.gs<br/>1時間おきに確定タブを検知"] -->|"repository_dispatch"| ACT
  GASSRC["apps_script/Code.gs"] -->|"手動で貼り付け・再デプロイ"| GASWEB["Apps Script Web アプリ"]
  ENV["Vercel 環境変数<br/>ANTHROPIC_API_KEY / GEMINI_API_KEY<br/>APPS_SCRIPT_URL / APPS_SCRIPT_TOKEN<br/>AGENT_MODEL / GEMINI_MODEL"] --> VC
```

---

## 2. ER図

RDB は使っておらず、Google スプレッドシートの各シートが「テーブル」に相当する。
主キーや外部キーの制約は無く、**「日時＋事業部＋担当」の組が実質的なキー**になっている。
図中の関係線は「アプリのコードがどう突き合わせているか」を表す論理的なもの。

### 2-1. アプリが書き込むデータ（会議DX スプレッドシート・会議ドキュメント）

職員マスタを軸に2枚に分けた。どちらも同じスプレッドシートの中のシート。

#### 2-1a. 会議AI → 報告、数値報告、全体会議振り返り

```mermaid
erDiagram
  STAFF["職員マスタ（lib/staff.ts・コード内定数）"] {
    string campus "事業部（6区分）"
    string name "氏名"
    boolean isAdmin "総務・人事・支援・管理 なら管理部門"
  }
  DEPT_CAMPUS["校舎マスタ（lib/summerNumbers.ts CAMPUSES_BY_DEPT）"] {
    string dept "部門"
    string campus "校舎名"
  }
  SESSION["セッション Cookie（chishokan_session）"] {
    string name "氏名"
    string campus "事業部"
    int maxAge "12時間"
  }

  CHAT_LOG["会話ログ シート"] {
    datetime ts "日時"
    string campus "事業部"
    string user "担当"
    text input "入力（機能名の接頭辞付き）"
    text output "出力"
  }
  MEETING_REVIEW["全体会議振り返り シート"] {
    datetime ts "日時"
    string campus "事業部"
    string user "担当"
    text content "内容"
  }
  SUMMER_NUMBERS["夏期数値 シート"] {
    datetime ts "日時"
    string dept "部門"
    string campus "校舎"
    string user "入力者"
    string recruit "招待外部生募集｜申込・目標・昨年"
    string interview "継続面談｜実施数"
    string retention "外部生継続｜継続数・昨年継続数・昨年母数"
    string mock "8月模試外部生｜今年・昨年・目標"
    string students "生徒数｜9月現在・昨年9月"
    string grades "通知表回収状況"
    string other "その他"
  }
  SUCCESS_CASE["成功事例 シート"] {
    datetime ts "日時（報告転記時）"
    string campus "事業部"
    string user "担当"
    string title "件名"
    text action "取り組み"
    text result "結果"
    text point "他でも使えるポイント"
  }
  REPORT_SECTION["事前報告セクション（会議ドキュメント 部門タブ）"] {
    string tab "部門タブ（TAB_HINTS で振り分け）"
    string heading "部門／担当　日時（見出し2）"
    text content "報告文（改行ごとに段落）"
  }


  STAFF ||--o| SESSION : "ログインで発行"
  STAFF ||--o{ CHAT_LOG : "事業部＋担当"
  STAFF ||--o{ MEETING_REVIEW : "事業部＋担当"
  STAFF ||--o{ SUMMER_NUMBERS : "入力者（校舎ごとに最新1件を採用）"
  DEPT_CAMPUS ||--o{ SUMMER_NUMBERS : "部門＋校舎"
  STAFF ||--o{ REPORT_SECTION : "部門タブ＋見出し"
  REPORT_SECTION ||--o{ SUCCESS_CASE : "報告文の ■成功事例 を抽出（lib/successCases.ts）"
```

#### 2-1b. 部門会議議事録、中間報告、お問い合わせ

```mermaid
erDiagram
  STAFF["職員マスタ（lib/staff.ts・コード内定数）"] {
    string campus "事業部（6区分）"
    string name "氏名"
    boolean isAdmin "総務・人事・支援・管理 なら管理部門"
  }

  DEPT_MINUTES["部門会議議事録 シート（1会議1行）"] {
    datetime ts "日時"
    string campus "部門"
    string user "入力者"
    string title "会議名"
    string date "開催日時"
    string place "場所"
    string attendees "出席者"
    text agenda "予定議題"
    text minutes "議事録本文"
    text quality "会議の質チェック"
  }
  DEPT_DECISION["部門決定事項 シート（1決定1行）"] {
    datetime ts "日時（議事録と同じ）"
    string campus "部門"
    string user "入力者"
    string meeting "会議名"
    string date "開催日時"
    string title "件名"
    text detail "内容"
    text reason "理由・背景"
    string owner "担当"
    string due "期限"
    string related "関係部門"
  }

  PROGRESS_ITEM["中間報告項目 シート（1行1項目）"] {
    string campus "事業部"
    string item "項目（この表記のまま AI が尋ねる）"
  }
  PROGRESS_STATUS["中間報告状況 シート"] {
    datetime ts "日時"
    string campus "事業部"
    string user "担当"
    text content "報告本文（項目ごとの進捗を含む）"
  }
  PROGRESS_SECTION["中間報告セクション（会議ドキュメント 中間報告タブ）"] {
    string tab "部門の中間報告タブ"
    string heading "【中間報告】部門／担当　日時"
    text content "報告文"
  }

  INQUIRY["問い合わせ シート（社内の不具合・要望）"] {
    int row "シート行番号（更新時のキー）"
    datetime ts "日時"
    string campus "事業部"
    string user "担当"
    string category "種別"
    text content "内容"
    string imageUrl "画像URL（Drive）"
    text reply "回答"
    string repliedBy "回答者（管理部門）"
    string repliedAt "回答日時"
  }
  INQUIRY_IMAGE["お問い合わせ画像（Google ドライブ）"] {
    string url "共有リンク（閲覧可）"
    string mime "画像形式"
  }

  STAFF ||--o{ DEPT_MINUTES : "部門＋入力者"
  DEPT_MINUTES ||--o{ DEPT_DECISION : "日時＋部門＋会議名で紐付け（lib/deptMinutesParse.ts）"
  STAFF ||--o{ PROGRESS_ITEM : "事業部ごとの定例項目（管理部門が編集）"
  PROGRESS_ITEM }o..o{ PROGRESS_STATUS : "項目名が報告本文に埋め込まれる"
  STAFF ||--o{ PROGRESS_STATUS : "事業部＋担当"
  PROGRESS_SECTION ||--|| PROGRESS_STATUS : "同時に記録"
  STAFF ||--o{ INQUIRY : "投稿者（本人のみ編集可）"
  STAFF ||--o{ INQUIRY : "回答者（管理部門のみ）"
  INQUIRY ||--o| INQUIRY_IMAGE : "画像URL"
```

### 2-2. 読み取り専用で参照する外部データ

アプリからは書き込まない。原本は各部門が普段どおり更新する。

```mermaid
erDiagram
  INQUIRY_BOARD["問合せ管理（別スプレッドシート・校舎別シート）"] {
    string campus "校舎（シート名）"
    string no "No.（校舎名＋No. で原本を引く）"
    string date "日付（問い合わせ日）"
    string name "生徒氏名（GAS で 1文字目＋○ にマスク）"
    string school "学校名"
    string grade "学年"
    string source "媒体"
    string term "受講期"
    string contacted "連絡"
    string trialDate "体験日（体験は体験日の月で数える）"
    string trial "体験（〇✕）"
    string meetingDate "入塾提案面談日"
    string agreed "本人OK"
    string closeDate "クローズ予定日"
    string result "結果（入塾／講習会申込／見送り／空＝追客中）"
    string note "備考（定型文除去・200字）"
  }
  INQUIRY_STATS["校舎別集計（lib/inquiryBoard.ts・実行時に算出）"] {
    string campus "校舎"
    string ym "年月（当月・前月）"
    int total "問い合わせ件数"
    int joined "入塾"
    int applied "講習会申込"
    int declined "見送り"
    int open "追客中"
    int trialsThisMonth "体験（体験日ベース）"
  }
  GOAL["秋～冬行動計画（中等部会議議事録スプレッドシートのタブ）"] {
    int month "月"
    string campus "校舎（中等部＝4校舎合計）"
    string metric "指標（今月入会／体験授業／サイトク／模試 等）"
    number target "目標"
    number actual "実績（手入力）"
  }
  YOKO_DOC["要項 Markdown（knowledge/40_要項/**.md）"] {
    string file "パス（出典表示に使う）"
    string title "講座名"
    string status "確定／下書き（確定だけ AI に渡る）"
    string owner "確定させた人"
    date updated "作成日"
    string source "原本（Google ドキュメントのタブ）"
    string dept "部門"
    text body "本文（対象・日程・受講料・申込・支払い…）"
  }
  YOKO_CARD["要項カード（lib/yokoCards.ts・実行時に算出）"] {
    string title "短縮した題名"
    string grades "学年"
    string period "実施期間（本文の日程から）"
    string fees "受講料（塾生／一般生）"
  }
  GLOSSARY["用語辞書（knowledge/00_index/GLOSSARY.md）"] {
    string term "用語"
    string gloss "意味"
  }
  COMPANY_KNOWLEDGE["会社の前提知識（lib/companyKnowledge.ts）"] {
    text philosophy "理念・社長方針"
    text terms "用語定義"
    string fiscal "期（5月始まり・実行時に算出）"
  }

  INQUIRY_BOARD ||--o{ INQUIRY_STATS : "校舎×月で集計"
  INQUIRY_STATS }o--o{ GOAL : "校舎名を正規化して突き合わせ（lib/goals.ts）"
  YOKO_DOC ||--o| YOKO_CARD : "確定済みで実施中・まもなくのみ"
  GLOSSARY }o..o{ COMPANY_KNOWLEDGE : "文字起こしヒント（lib/transcribeVocab.ts）で合流"
```

### 2-3. データ一覧（保存先・書き手・読み手）

| データ | 保存先 | 書き込む経路 | 読む経路 | 備考 |
|---|---|---|---|---|
| 会話ログ | 会議DX シート「会話ログ」 | 各 AI Route → `lib/log.ts` → GAS `log` | （人が直接見る） | Vercel Logs にも `[CHAT_LOG]` で出力 |
| 事前報告 | 会議ドキュメント 部門タブ | `/api/report` → GAS `appendReport` | （会議で使う） | タブは部門名の部分一致で振り分け |
| 成功事例 | シート「成功事例」 | `/api/report` が報告文から抽出 → GAS `saveSuccess` | `/api/success` → ダッシュボード | 報告転記の付随処理。失敗しても報告は成功扱い |
| 夏期数値 | シート「夏期数値」 | `/api/numbers` POST → GAS `saveNumbers` | `/api/numbers` GET、`/api/chat`（summer） | 校舎ごとに最新1件を採用。見出しは `NUMBER_FIELDS` と連動 |
| 全体会議振り返り | シート「全体会議振り返り」 | `/api/meeting-review` → GAS `saveReview` | （人が直接見る） | |
| 部門会議議事録 | シート「部門会議議事録」 | `/api/dept-minutes/save` → GAS `saveDeptMinutes` | `/api/dept-minutes/list?scope=minutes` | 1会議1行。人が確認した最終テキストを保存 |
| 部門決定事項 | シート「部門決定事項」 | 同上（保存時に抽出） | `/api/dept-minutes/list` | 1決定1行。部門横断の見える化 |
| 中間報告 | 会議ドキュメント 中間報告タブ ＋ シート「中間報告状況」 | `/api/progress/submit` → GAS `appendProgress` | `/api/progress/latest` → ダッシュボード | 本文から項目と進捗だけを抜いて表示 |
| 中間報告項目 | シート「中間報告項目」 | `/api/progress/items` PUT（管理部門） → GAS `saveProgressItems` | `/api/progress`、`/api/progress/items` GET | 未登録の部門は `DEFAULT_PROGRESS_DEPT_ITEMS` を使う |
| お問い合わせ | シート「問い合わせ」＋ Drive 画像 | `/api/inquiry` POST/PATCH/PUT → GAS `saveInquiry` ほか | `/api/inquiry` GET | 行番号がキー。回答は管理部門のみ |
| 議事録スレッド（準備中） | シート「議事録」 | `/api/minutes/save` → GAS `saveMinutes` | ─ | 画面は「準備中」表示 |
| 問合せ管理 | 別スプレッドシート（`INQUIRY_BOARD_ID`） | ─（部門が原本を更新） | GAS `listInquiryBoard` → `/api/inquiry-qa` | 個人情報は GAS で落としてから返す |
| 目標（秋～冬行動計画） | 中等部会議議事録スプレッドシート（`GOALS_BOOK_ID`） | ─ | GAS `listGoals` → `/api/inquiry-qa` | タブは名前で引く |
| 要項 | `knowledge/40_要項/*.md` | `scripts/import-yoko.mjs` → git | `/api/yoko-qa` | `status: 確定` だけ AI に渡す |
| 用語辞書 | `knowledge/00_index/GLOSSARY.md` | git | `/api/dept-minutes/transcribe` | 文字起こしのヒントに使う |
| 職員マスタ | `lib/staff.ts` | git | `/api/login`、各 API の権限判定 | テスト運用のため合言葉は停止中 |

---

## 3. 権限と境界

| 区分 | 判定 | 影響範囲 |
|---|---|---|
| ログイン | 職員マスタに存在する「事業部＋氏名」の組 | 全画面（`app/(app)/layout.tsx` で未ログインは `/login` へ） |
| 管理部門（総務・人事・支援・管理） | `session.campus === ADMIN_CAMPUS` | 中間報告項目の編集、お問い合わせへの回答、問い合わせQA の閲覧 |
| 小中等部 | `ALLOWED_DEPTS` | 問い合わせQA の閲覧（画面と API の両方で制限） |
| 個人情報の境界 | Apps Script `listInquiryBoard_` | 氏名マスク・電話・住所・保護者名・メール除外。アプリにも Claude にも渡らない |
| API キーの境界 | Vercel 環境変数 | ブラウザには一切渡らない |

既知の要ハードニング（README「ログ / セキュリティ」参照）: セッションは署名なし Base64、認証は氏名＋事業部のみ。
知識ベースに機微情報を載せる前に Google SSO への移行が前提。

---

## 4. データ構成の方針（2026-09-16 決定）

目指す形は「アプリ → Google（ログ記録）」「Google → git（ナレッジ同期）」「アプリ → git（読み取り・検索）」の3本。
現状との差と、それぞれの扱いを決めた。

| 矢印 | 現状 | 決定 |
|---|---|---|
| ① アプリ → Google（ログ記録） | Apps Script 経由でシート・ドキュメントに記録している | **現状のままで OK** |
| ② Google → git（ナレッジ同期） | 要項だけ。書き出し→取り込み→確認→push をすべて人手で行う | **要項の「確定」を起点に自動化する**（下記 4-1） |
| ③ アプリ → git（読み取り・検索） | 要項と用語辞書だけを、ビルド同梱ファイルから全文読み | **保留**。基本機能の開発完了後、全体を組み直すタイミングで着手（下記 4-2） |

### 4-1. ② 要項の確定 → git 自動同期（実装済み・要セットアップ）

**起点**: 要項ドキュメント（Google ドキュメント）の各タブ ＜基本情報＞ の「ステータス」が「確定」になったこと。
確定していないタブは git に流さない（下書きの金額・期限が AI に渡る事故を防ぐ。現行ルールを維持）。

```mermaid
flowchart LR
  DOC["要項ドキュメント<br/>（Google ドキュメント・タブ＝1要項）"]
  GAS["Apps Script<br/>ステータス列を監視<br/>（編集トリガー or 夜間）"]
  ACT["GitHub Actions<br/>sync-yoko.yml"]
  EXP["Drive API で<br/>Markdown 書き出し"]
  IMP["scripts/import-yoko.mjs<br/>--sync（確定タブのみ上書き）"]
  CHK["scripts/check-yoko.mjs --confirmed<br/>必須項目チェック"]
  PR["Pull Request<br/>sync/yoko-YYYYMMDD"]
  REV["総務が差分を確認してマージ"]
  VC["Vercel 自動デプロイ<br/>→ 要項QA に反映"]

  DOC -->|"確定に変更"| GAS
  GAS -->|"repository_dispatch"| ACT
  ACT --> EXP --> IMP --> CHK --> PR --> REV -->|"main にマージ"| VC
```

実装: `.github/workflows/sync-yoko.yml`・`.github/workflows/check-yoko.yml`・`scripts/export-yoko-doc.mjs`・
`scripts/import-yoko.mjs --sync`・`apps_script/YokoSync.gs`。セットアップ手順は README「自動同期」の節。

**処理の中身**

1. **検知**: Apps Script が要項ドキュメントのタブを走査し、「ステータス：確定」のタブの一覧とハッシュを Script Properties に持つ。前回と差があれば GitHub の `repository_dispatch` を叩く。トリガーは編集時（onEdit 相当は Docs では使えないため時間主導で 1 時間おき）または夜間 1 回。
   ※ GAS を使わず GitHub Actions の夜間スケジュールだけでも成立する。GAS 側は「確定したらすぐ反映」を早めるための追加部品。
2. **書き出し**: GitHub Actions が Google サービスアカウントで Drive API `files.export`（`text/markdown`）を呼び、人が今「ファイル > ダウンロード > Markdown」でやっているものと同じ Markdown を得る。要項ドキュメントをサービスアカウントに閲覧共有しておく。
3. **取り込み**: `scripts/import-yoko.mjs` に `--sync` モードを足す。
   - ステータスが「確定」のタブだけを対象にする
   - **既存ファイルは front matter の `title` と講座名で突き合わせて上書きする**（ドキュメントが正本）。
     現行の「既存は上書きしない」は手動運用向けの安全策なので、`--sync` では逆にする
   - 突き合わせできない新規は `YYYY-MM_講座名.md` で作る。年月は作成日から取る
   - git 側が確定だったタブがドキュメント側で確定でなくなった場合は `status: 下書き` に戻す（AI が答えなくなる）
   - `_` 始まりのファイル・テンプレートタブは今までどおり触らない
4. **検査**: `check-yoko.mjs --confirmed` を CI として実行する。不足があれば PR に赤を付ける（ファイルは書くが、マージを止める）。
5. **PR**: 差分があるときだけ固定ブランチ `sync/yoko` で PR を作る（開いている PR があればそこに積む。PR が溜まらないようにするため）。総務がマージ。マージで Vercel が再デプロイし、要項QA に反映される。

**先に決めておくこと**

- **ファイル名の突き合わせ鍵**。今の 24 ファイルは取り込み後に人手で `2026-07_夏期_中等部.md` のように改名されており、タブ順の連番（`01_…`）とは一致しない。自動化では **front matter の `title` を鍵**にするので、ドキュメント側の講座名を変えると別ファイル扱いになる。講座名の変更は「旧ファイルを削除する PR」とセットで行う運用にする。
- **認証情報の置き場**。Google サービスアカウントの鍵は GitHub Secrets。GAS から dispatch する場合は GitHub の fine-grained トークン（Contents: write のみ）を Script Properties に置く。Vercel 側には何も足さない。
- **マージの自動化**。当面は人がマージする。check が緑なら自動マージにするかは運用が回ってから決める。
- **必須項目チェックの必須化**。2026-09 時点で確定済み 22 件すべてに「経理連絡事項」が無いため、チェックは当面「警告」に留めている。既存分を直したら必須化する（README 参照）。
- **旧形式のタブ**。＜基本情報＞が無いタブは同期の対象外（触らない）。自動同期に載せたい要項にはタブに ＜基本情報＞ を足す。

**この設計で変わらないこと**: `status: 確定` 以外は AI に渡さない、個人情報を git に入れない、Google ドキュメントを実行時に直接読まない。

### 4-2. ③ アプリ → git の読み取り・検索（保留）

現在の使い方（確定要項 24 件・約 5 万字を毎回プロンプトに載せる）は、プロンプトキャッシュが効いているため実運用上の問題は出ていない。
**基本機能の開発が終わり、全体を構築し直すタイミングで以下をまとめて扱う。それまで触らない。**

そのとき見直す項目:

- `knowledge/00_index/CLAUDE.md` と `INDEX.md` はどのコードからも読まれていない。CLAUDE.md を system prompt の先頭で読む形にする
- 理念・社長方針・用語定義が `lib/companyKnowledge.ts` にハードコードされている。`knowledge/10_理念・方針/` などの Markdown に移し、ナレッジ側で育てられるようにする
- 「全文をプロンプトに載せる」から「索引（INDEX.md）を渡して tool use でファイルを開く」方式へ切り替える。要項以外（部門マニュアル・規程）を載せ始めると全文方式は破綻する（`docs/knowledge-base-architecture.md` §5 の設計）
- 読み取り経路がビルド同梱＋`fs`（`next.config.mjs` の `outputFileTracingIncludes`）に依存している。同梱漏れで本番だけ 0 件になる構造を、索引方式への移行とあわせて解消する
- 機微情報をナレッジに載せる前提として Google SSO への移行（`docs/knowledge-base-architecture.md` §6）
