-- Zoom ミーティングのホスト担当と、開始の記録。
-- ホストとして開始できるのは、会議ごとに決めた1人（ホスト担当）だけにする（lib/zoom/access.ts）。
-- Supabase の SQL Editor に貼り付けて実行する。何度実行しても壊れない。
--
-- ★0001 と同じく、下の2行の chishokan_dev を、dev 用はそのまま、本番用は chishokan_prod に書き換えて、2回実行する。
create schema if not exists chishokan_dev;
set search_path = chishokan_dev;

alter table zoom_meetings add column if not exists host_name  text not null default '';  -- ホスト担当（空なら事前共有した本人）
alter table zoom_meetings add column if not exists started_by text not null default '';  -- 最後に［ホストとして開始］を押した人
alter table zoom_meetings add column if not exists started_at timestamptz;               -- その日時
