-- 智翔館AI（/ai）の会話の保存（履歴・保存した会話）と、いつものコンテキスト。Supabase の SQL Editor に貼り付けて実行する。
-- 何度実行しても壊れないよう「if not exists」で書いてある。
--
-- ★0001 と同じく、下の2行の chishokan_dev を、dev 用はそのまま、本番用は chishokan_prod に書き換えて、2回実行する。
create schema if not exists chishokan_dev;
set search_path = chishokan_dev;
--
-- アクセスの考え方：
--   アプリのサーバ（Vercel）だけが service_role キーで読み書きする。職員のブラウザは直接触らない。
--   持ち主（owner）は、ログインで確かめたメールアドレス（小文字）。アプリは持ち主の行だけを読み書きする。
--   全テーブルで RLS を有効にし、ポリシーは作らない。
--   会話の中身は職員本人のもの。管理者が画面で見る機能は作らない（会話ログは、これとは別にスプレッドシートに残っている）。
--
-- 残す期間（アプリが一覧を開くたびに、その人の古いものを消す。決まりは lib/chishokanAi/savedRules.ts）：
--   履歴（kind = 履歴）………… 最後に使ってから30日・50件まで
--   保存した会話（kind = 保存）… 最後に使ってから1年・20件まで
--   職員一覧から外れた人 ……… 30日後に消す

-- 会話（1行＝1つの会話）。data の形は lib/chishokanAi/savedConversation.ts（ファイルに書き出す形と同じ）
create table if not exists ai_conversations (
  owner       text not null,                                    -- 持ち主（メールアドレス・小文字）
  id          text not null,                                    -- 会話番号（会話ログの「会話: …」と同じ）
  kind        text not null default '履歴' check (kind in ('履歴', '保存')),
  title       text not null default '',                         -- 一覧に出す名前（保存のときは職員が付ける）
  data        jsonb not null,                                   -- 会話・コンテキスト（前の版も）・次の質問に渡す資料
  turns       integer not null default 0,                       -- 質問の数
  chars       integer not null default 0,                       -- 大きさの目安（data の文字数）
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),               -- 最後に使った日時（残す期間の起点）
  primary key (owner, id)
);
create index if not exists ai_conversations_list on ai_conversations (owner, kind, updated_at desc);

-- いつものコンテキスト（会話をまたいで使う前提。1人10個まで）
create table if not exists ai_context_presets (
  owner       text not null,
  id          text not null,                                    -- p1, p2 …
  name        text not null,
  text        text not null,
  auto        boolean not null default false,                   -- true なら、新しい会話に自動で入れる
  sort_order  integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (owner, id)
);

alter table ai_conversations enable row level security;
alter table ai_context_presets enable row level security;

-- アプリのサーバ（service_role）だけが読み書きできるようにする。
do $$
declare sch text := current_schema();
begin
  execute format('grant all on all tables in schema %I to service_role', sch);
end $$;
