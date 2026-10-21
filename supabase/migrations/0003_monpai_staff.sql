-- 門配スタッフ（大学生・アルバイト）の名簿。スタッフ専用画面（/monpai-staff）のログインに使う。
-- Supabase の SQL Editor に貼り付けて実行する。何度実行しても壊れない。
--
-- ★0001 と同じく、下の2行の chishokan_dev を、dev 用はそのまま、本番用は chishokan_prod に書き換えて、2回実行する。
create schema if not exists chishokan_dev;
set search_path = chishokan_dev;

-- 1行＝スタッフ1人。ログイン画面で「所属」→「名前」の順に選ぶ。
-- 門配の記録の担当欄（staff1 / staff2）は名前の文字で持つので、ここの name と同じ書き方にする
-- （姓だけ「松田」と書いた記録も「松田花子」でログインした人の担当として出る）。
create table if not exists monpai_staff (
  affiliation  text not null,                         -- 所属（例 RED個別 日野校／長崎県立大学）
  name         text not null,                         -- 名前（フルネーム）
  sort_order   integer not null default 0,
  active       boolean not null default true,          -- false にするとログインできなくなる（辞めた人）
  note         text not null default '',
  created_at   timestamptz not null default now(),
  primary key (affiliation, name)
);

alter table monpai_staff enable row level security;

-- アプリのサーバ（service_role）だけが読み書きできるようにする。
do $$
declare sch text := current_schema();
begin
  execute format('grant all on all tables in schema %I to service_role', sch);
end $$;
