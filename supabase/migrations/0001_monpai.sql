-- 門配管理（/monpai）のテーブル。Supabase の SQL Editor に貼り付けて実行する。
-- 何度実行しても壊れないよう「if not exists」「on conflict do nothing」で書いてある。
--
-- ★1つのプロジェクトに dev と本番を同居させるため、テーブルは区画（スキーマ）に分けて置く。
--   下の2行の chishokan_dev を、dev 用はそのまま、本番用は chishokan_prod に書き換えて、2回実行する。
--   （Vercel の環境変数 SUPABASE_SCHEMA にも同じ名前を入れる）
create schema if not exists chishokan_dev;
set search_path = chishokan_dev;
--
-- アクセスの考え方：
--   アプリのサーバ（Vercel）だけが service_role キーで読み書きする。ブラウザから直接は触らせない。
--   そのため全テーブルで RLS（行単位のアクセス制御）を有効にし、ポリシーは作らない
--   （＝ anon / authenticated キーでは何も読めない。service_role は RLS を通らない）。

-- 学校マスタ（ボトムの計算のもと）
create table if not exists monpai_schools (
  name        text primary key,                       -- 学校名（記録はこの名前で学校を指す）
  district    text not null,                          -- 地区
  kind        text not null check (kind in ('中', '小')),
  students    integer not null default 0 check (students >= 0), -- 中＝全校、小＝小2〜6
  sort_order  integer not null default 0,
  note        text not null default ''
);

-- 月別設定（率の上書き・募集期）。school が '' ならその月の全校に効く。
create table if not exists monpai_month_settings (
  month    text not null check (month ~ '^\d{4}-\d{2}$'),
  school   text not null default '',
  rate     numeric check (rate is null or (rate > 0 and rate <= 1)), -- 0.5 = 50%
  recruit  boolean not null default false,
  primary key (month, school)
);

-- 門配の記録（1行＝ある日・ある学校での門配1回。計画と実績を同じ行で持つ）
create table if not exists monpai_records (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  time        text not null default '',
  district    text not null,
  school      text not null,
  staff1      text not null default '',
  staff2      text not null default '',
  material    text not null default '',               -- 配布物（複数は「、」区切り）
  planned     integer not null default 0 check (planned >= 0),
  done        integer check (done is null or done >= 0), -- 未報告は null
  status      text not null default '予定' check (status in ('予定', '実施', '中止')),
  reason      text not null default '',
  memo        text not null default '',
  created_at  timestamptz not null default now(),
  created_by  text not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  text not null default '',
  deleted_at  timestamptz                               -- 削除は印を付けるだけ（行は消さない）
);
create index if not exists monpai_records_date_idx on monpai_records (date) where deleted_at is null;

-- 配布物・ノベルティ（在庫は「入出庫の合計 − 実績の配布数」で毎回計算する）
create table if not exists monpai_materials (
  name       text primary key,
  kind       text not null default 'その他',
  prep       text not null default '',                 -- 準備担当（NEP／教室）
  threshold  integer not null default 0 check (threshold >= 0), -- 発注目安
  note       text not null default ''
);

create table if not exists monpai_material_movements (
  id          bigint generated always as identity primary key,
  date        date not null,
  name        text not null references monpai_materials (name) on update cascade,
  qty         integer not null check (qty <> 0),        -- 入庫はプラス、廃棄・調整はマイナス
  memo        text not null default '',
  created_by  text not null default '',
  created_at  timestamptz not null default now()
);

alter table monpai_schools            enable row level security;
alter table monpai_month_settings     enable row level security;
alter table monpai_records            enable row level security;
alter table monpai_materials          enable row level security;
alter table monpai_material_movements enable row level security;

-- 学校マスタの初期値（「RED広報関連」の画面から読み取った値。運用前に確認すること）
-- 駅前・佐々・西海大島の学校は、Supabase の Table Editor で monpai_schools に追加する。
insert into monpai_schools (name, district, kind, students, sort_order, note) values
  ('大野中', '大野', '中', 546, 1, ''), ('中里中', '大野', '中', 376, 2, ''), ('柚木中', '大野', '中', 99, 3, ''),
  ('大野小', '大野', '小', 638, 4, ''), ('中里小', '大野', '小', 426, 5, ''), ('春日小', '大野', '小', 457, 6, ''),
  ('日野中', '日野', '中', 380, 1, ''), ('相浦中', '日野', '中', 447, 2, ''), ('愛宕中', '日野', '中', 216, 3, ''),
  ('日野小', '日野', '小', 479, 4, ''), ('相浦小', '日野', '小', 408, 5, ''),
  ('日宇中', '広田', '中', 613, 1, '日宇エリア'), ('大塔小', '広田', '小', 617, 2, '日宇エリア'),
  ('黒髪小', '広田', '小', 462, 3, '日宇エリア'), ('日宇小', '広田', '小', 329, 4, '日宇エリア')
on conflict (name) do nothing;

-- 在庫の計算用の集計（行が増えても1回で取れるよう、データベース側で合計しておく）。
-- security_invoker = true：呼んだ人の権限で動かす（service_role 以外からは読めないまま）。
create or replace view monpai_material_usage with (security_invoker = true) as
  select material, sum(done)::integer as done
  from monpai_records
  where deleted_at is null and material <> '' and done is not null
  group by material;

create or replace view monpai_material_received with (security_invoker = true) as
  select name, sum(qty)::integer as qty
  from monpai_material_movements
  group by name;

-- アプリのサーバ（service_role）だけが読み書きできるようにする。anon / authenticated には権限を渡さない。
-- ※ current_schema() は上の set search_path で指定した区画。
do $$
declare sch text := current_schema();
begin
  execute format('grant usage on schema %I to service_role', sch);
  execute format('grant all on all tables in schema %I to service_role', sch);
  execute format('grant all on all sequences in schema %I to service_role', sch);
  execute format('alter default privileges in schema %I grant all on tables to service_role', sch);
  execute format('alter default privileges in schema %I grant all on sequences to service_role', sch);
end $$;
