-- つきいち改善（/kaizen）のテーブルと写真の置き場。Supabase の SQL Editor に貼り付けて実行する。
-- 何度実行しても壊れないよう「if not exists」「on conflict do nothing」で書いてある。
--
-- ★1つのプロジェクトに dev と本番を同居させるため、テーブルは区画（スキーマ）に分けて置く。
--   下の2行の chishokan_dev を、dev 用はそのまま、本番用は chishokan_prod に書き換えて、2回実行する。
--   （0001_monpai.sql と同じ。Vercel の環境変数 SUPABASE_SCHEMA にも同じ名前を入れる）
create schema if not exists chishokan_dev;
set search_path = chishokan_dev;
--
-- アクセスの考え方は門配管理・適性検査と同じ：
--   アプリのサーバ（Vercel）だけが service_role キーで読み書きする。職員のブラウザは直接は触らない。
--   全テーブルで RLS を有効にし、ポリシーは作らない。
-- 誰が直せるか・投票できるか・何票までかは、アプリ側（lib/kaizen/model.ts）で確かめてから書く。

-- 改善（1改善1行）
create table if not exists kaizen_items (
  id             uuid primary key,
  month          text not null check (month ~ '^\d{4}-\d{2}$'),  -- 対象月（提出した月。出し忘れは先月）
  submitted_at   timestamptz not null default now(),
  members        text[] not null default '{}',                   -- 提出者（先頭が代表。一緒に取り組んだ人も入る）
  campus         text not null default '',                       -- 校舎（「校」は付けない）
  title          text not null,
  before_text    text not null default '',
  after_text     text not null default '',
  -- 写真。下の kaizen-photos バケットの中のパス（例 chishokan_prod/<改善ID>/before-1760000000000.jpg）。
  -- 旧スプレッドシートから移した写真は Drive の URL のまま入る
  before_photos  text[] not null default '{}',
  after_photos   text[] not null default '{}',
  entered_by     text not null default '',                       -- 入力した人（ログインしていた人）
  entered_dept   text not null default '',
  updated_at     timestamptz not null default now(),
  updated_by     text not null default '',
  source         text not null default '',                       -- 旧スプレッドシートから移した行の目印（2回取り込んでも二重にしない）
  deleted_at     timestamptz                                     -- 消した改善（行は残す。写真は消す）
);
create index if not exists kaizen_items_month_idx on kaizen_items (month);

-- 投票（対象月×投票者で1行。入れ直すと上書き、全部外すと行を消す）
create table if not exists kaizen_votes (
  month     text not null check (month ~ '^\d{4}-\d{2}$'),
  voter     text not null,
  dept      text not null default '',
  item_ids  text[] not null default '{}',                        -- 投票先の改善 ID（3つまで）
  voted_at  timestamptz not null default now(),
  primary key (month, voter)
);

-- 管理部門が早めに締め切った（または再開した）月
create table if not exists kaizen_closes (
  month      text primary key check (month ~ '^\d{4}-\d{2}$'),
  closed     boolean not null,
  closed_by  text not null default '',
  closed_at  timestamptz not null default now()
);

alter table kaizen_items  enable row level security;
alter table kaizen_votes  enable row level security;
alter table kaizen_closes enable row level security;

-- 写真の置き場（Storage のバケット）。公開しない。
-- アプリのサーバが service_role で読み書きし、画面には期限つきの URL（12時間）だけを渡す。
-- バケットは dev と本番で1つを共用し、中のフォルダを区画名（chishokan_dev / chishokan_prod）で分ける。
-- 画面で長辺1600pxに縮めてから送るので、1枚5MBを上限にする。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kaizen-photos', 'kaizen-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- アプリのサーバ（service_role）だけが読み書きできるようにする（0001_monpai.sql と同じ）。
do $$
declare sch text := current_schema();
begin
  execute format('grant usage on schema %I to service_role', sch);
  execute format('grant all on all tables in schema %I to service_role', sch);
  execute format('grant all on all sequences in schema %I to service_role', sch);
  execute format('alter default privileges in schema %I grant all on tables to service_role', sch);
  execute format('alter default privileges in schema %I grant all on sequences to service_role', sch);
end $$;
