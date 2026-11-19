-- アプリが作った Zoom ミーティングの対応表（部門会議の事前共有 ⇔ Zoom ミーティング）。
-- 事前共有を出したときにアプリが Zoom ミーティングを作り、ここに1行残す。
-- 録画完了の通知が来たときに、ミーティングIDからどの部門・どの会議の録画かを引くために使う。
-- Supabase の SQL Editor に貼り付けて実行する。何度実行しても壊れない。
--
-- ★0001 と同じく、下の2行の chishokan_dev を、dev 用はそのまま、本番用は chishokan_prod に書き換えて、2回実行する。
create schema if not exists chishokan_dev;
set search_path = chishokan_dev;

-- 1行＝アプリが作った Zoom ミーティング1件。
-- 個人情報は持たない（会議名・議題・出席者はスプレッドシートの「部門会議事前共有」にある）。
create table if not exists zoom_meetings (
  account       text not null,                          -- Zoom アカウント（'1'＝公式1、'2'＝公式2）
  meeting_id    text not null,                          -- Zoom のミーティングID
  preshare_id   text not null,                          -- 事前共有ID（「部門会議事前共有」シート）
  campus        text not null default '',               -- 部門
  start_time    timestamptz,                            -- 開始日時
  duration_min  integer not null default 60,            -- 長さ（分）
  created_by    text not null default '',               -- 作った人
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (account, meeting_id)
);

create index if not exists zoom_meetings_preshare_idx on zoom_meetings (preshare_id);

alter table zoom_meetings enable row level security;

-- アプリのサーバ（service_role）だけが読み書きできるようにする。
do $$
declare sch text := current_schema();
begin
  execute format('grant all on all tables in schema %I to service_role', sch);
end $$;
