-- 部門会議の事前共有を、出席者が事前に見たかどうか（「確認しました」のチェック）。
-- ダッシュボードの事前共有カードを開いて、出席者がチェックを入れると1行できる。外すと消える。
-- Supabase の SQL Editor に貼り付けて実行する。何度実行しても壊れない。
--
-- ★0001 と同じく、下の2行の chishokan_dev を、dev 用はそのまま、本番用は chishokan_prod に書き換えて、2回実行する。
create schema if not exists chishokan_dev;
set search_path = chishokan_dev;

create table if not exists preshare_confirms (
  preshare_id  text not null,                       -- 事前共有ID
  name         text not null,                       -- 確認した人
  campus       text not null default '',            -- その人の部門
  confirmed_at timestamptz not null default now(),  -- 確認した日時
  primary key (preshare_id, name)
);

alter table preshare_confirms enable row level security;

-- アプリのサーバ（service_role）だけが読み書きできるようにする。
do $$
declare sch text := current_schema();
begin
  execute format('grant all on all tables in schema %I to service_role', sch);
end $$;
