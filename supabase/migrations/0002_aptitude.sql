-- 適性検査（/aptitude・/exam）のテーブル。Supabase の SQL Editor に貼り付けて実行する。
-- 何度実行しても壊れないよう「if not exists」で書いてある。
--
-- ★1つのプロジェクトに dev と本番を同居させるため、テーブルは区画（スキーマ）に分けて置く。
--   下の2行の chishokan_dev を、dev 用はそのまま、本番用は chishokan_prod に書き換えて、2回実行する。
--   （0001_monpai.sql と同じ。Vercel の環境変数 SUPABASE_SCHEMA にも同じ名前を入れる）
create schema if not exists chishokan_dev;
set search_path = chishokan_dev;
--
-- アクセスの考え方は門配管理と同じ：
--   アプリのサーバ（Vercel）だけが service_role キーで読み書きする。受検者のブラウザも職員のブラウザも直接は触らない。
--   全テーブルで RLS を有効にし、ポリシーは作らない。
--
-- 初期の版（v1：設問100問・尺度・職種ごとの判定基準）は SQL では入れない。
-- 版が1件も無いとき、アプリが lib/aptitude/seed.ts の中身を書き込む（シードを2か所に持たないため）。
--
-- 性格検査の結果は機微な個人情報。列を足すときは必要性を見直し、要らない項目は持たない。

-- 版（設問・尺度・判定基準のまとまり）。受検はどの版で受けたかを記録する
create table if not exists apt_versions (
  id            text primary key,                       -- 例 v1, v2
  name          text not null,
  status        text not null default '下書き' check (status in ('下書き', '公開', '終了')),
  note          text not null default '',
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  created_by    text not null default ''
);
-- 公開中の版は1つだけ
create unique index if not exists apt_versions_one_published on apt_versions ((status)) where status = '公開';

create table if not exists apt_scales (
  version_id   text not null references apt_versions (id) on delete cascade,
  code         text not null check (code in ('L', 'CP', 'NP', 'A', 'FC', 'AC', 'ST', 'EM', 'AV', 'IM')),
  name         text not null,
  kind         text not null check (kind in ('信頼性', 'エゴグラム', '適性', 'リスク')),
  description  text not null default '',
  sort_order   integer not null default 0,
  primary key (version_id, code)
);

create table if not exists apt_questions (
  version_id  text not null references apt_versions (id) on delete cascade,
  no          integer not null check (no between 1 and 999),
  text        text not null,
  scale_code  text not null,
  reverse     boolean not null default false,               -- true なら「いいえ」で1点
  active      boolean not null default true,                -- false なら採点に使わず、受検画面にも出さない
  note        text not null default '',                     -- 担当者向けの備考（受検者には出さない）
  primary key (version_id, no),
  foreign key (version_id, scale_code) references apt_scales (version_id, code)
);

-- 職種ごとの判定基準（A/B基準・虚偽の閾値・尺度ごとの重みと注意の閾値・確認ポイント）。形は lib/aptitude/model.ts の RoleRule
create table if not exists apt_rules (
  version_id  text not null references apt_versions (id) on delete cascade,
  role        text not null check (role in ('講師', '事務', '社員')),
  rule        jsonb not null,
  primary key (version_id, role)
);

-- 受検者（応募者）
create table if not exists apt_candidates (
  id              uuid primary key,
  name            text not null,
  kana            text not null default '',
  gender          text not null default '',
  birth_date      date,
  phone           text not null default '',
  email           text not null default '',
  role            text not null check (role in ('講師', '事務', '社員')),
  base            text not null,                            -- 拠点（智翔館／NEP／JEO）
  hire_status     text not null default '選考中' check (hire_status in ('選考中', '採用', '不採用', '辞退')),
  hire_status_at  timestamptz not null default now(),       -- 採用結果を最後に変えた日時（保存期間の起点）
  post_eval       integer check (post_eval is null or post_eval between 1 and 5), -- 入社後の評価（校正用）
  post_eval_note  text not null default '',
  memo            text not null default '',
  created_at      timestamptz not null default now(),
  created_by      text not null default '',
  updated_at      timestamptz not null default now(),
  updated_by      text not null default '',
  deleted_at      timestamptz                                 -- 削除は印を付けるだけ。30日後に完全に消す
);

-- 受検（1人に何回でも発行できる。Web は受検URLのトークンで開く。紙は職員が代理入力）
create table if not exists apt_sessions (
  id              uuid primary key,
  candidate_id    uuid not null references apt_candidates (id) on delete cascade,
  version_id      text not null references apt_versions (id),
  role            text not null check (role in ('講師', '事務', '社員')), -- 受検したときの職種（判定に使う）
  base            text not null,
  token           text not null unique,
  expires_at      timestamptz not null,
  method          text not null default 'Web' check (method in ('Web', '紙')),
  status          text not null default '未受検' check (status in ('未受検', '受検中', '完了', '取消')),
  question_order  jsonb not null default '[]',              -- 受検画面に出す順（設問番号の配列）
  consent_at      timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  created_by      text not null default ''
);
create index if not exists apt_sessions_candidate_idx on apt_sessions (candidate_id);

create table if not exists apt_answers (
  session_id   uuid not null references apt_sessions (id) on delete cascade,
  question_no  integer not null,
  answer       text not null check (answer in ('Y', 'N')),
  seconds      numeric,                                     -- 回答にかかった秒数（紙受検は null）
  answered_at  timestamptz not null default now(),
  primary key (session_id, question_no)
);

-- 採点結果（受検が完了したときに計算して保存。使った版・職種・計算日時も残す）
create table if not exists apt_results (
  session_id   uuid primary key references apt_sessions (id) on delete cascade,
  version_id   text not null references apt_versions (id),
  role         text not null,
  scores       jsonb not null,                              -- 尺度ごとの { raw, max, score }
  aptitude     integer not null,
  grade        text not null check (grade in ('A', 'B', 'C')),
  judgment     jsonb not null,                              -- 判定の全体（フラグ・理由・確認ポイント）
  avg_seconds  numeric,
  computed_at  timestamptz not null default now()
);

-- 閲覧・操作の記録（結果の閲覧・CSV出力・紙回答の入力・削除・版の公開など）
create table if not exists apt_logs (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  actor         text not null default '',
  actor_campus  text not null default '',
  action        text not null,
  candidate_id  uuid,                                       -- 受検者を完全に消しても記録は残す（外部キーにしない）
  session_id    uuid,
  detail        text not null default ''
);
create index if not exists apt_logs_candidate_idx on apt_logs (candidate_id);

alter table apt_versions   enable row level security;
alter table apt_scales     enable row level security;
alter table apt_questions  enable row level security;
alter table apt_rules      enable row level security;
alter table apt_candidates enable row level security;
alter table apt_sessions   enable row level security;
alter table apt_answers    enable row level security;
alter table apt_results    enable row level security;
alter table apt_logs       enable row level security;

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
