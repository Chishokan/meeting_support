-- 智翔館アプリのログインアカウント（ColorHRM と同じ「メールアドレス＋パスワード」方式）。
-- Supabase の SQL Editor に貼り付けて実行する。何度実行しても壊れないように書いてある。
--
-- ★0001 と同じく、下の2行の chishokan_dev を、dev 用はそのまま、本番用は chishokan_prod に書き換えて実行する。
create schema if not exists chishokan_dev;
set search_path = chishokan_dev;
--
-- アカウントの流れ：
--   管理者がメールアドレス・氏名・ロール・部門・担当教室でアカウントを発行する
--   → 本人のメールアドレスに「初期パスワード」と「パスワード変更用のURL」が届く
--   → 本人はメールアドレスとパスワードでログインする（初回は変更を求める）
--
-- パスワードは bcrypt（ColorHRM の PHP password_hash と同じ形式）で持つ。平文は保存しない。

create table if not exists app_users (
  id                    uuid primary key default gen_random_uuid(),
  email                 text not null,                                   -- ログインID（小文字にそろえて保存）
  name                  text not null,                                   -- 表示名（氏名）
  role                  text not null check (role in ('admin', 'staff', 'employee', 'teacher')),
  dept                  text not null default '',                        -- 事業部（会議DXの報告先などに使う）
  classrooms            text[] not null default '{}',                    -- 担当教室
  password_hash         text not null default '',
  must_change_password  boolean not null default true,                   -- 初期パスワードのままか
  is_active             boolean not null default true,                   -- false ならログインできない
  failed_count          integer not null default 0,                      -- 連続で間違えた回数
  locked_until          timestamptz,                                     -- 間違えすぎたときのロック期限
  last_login_at         timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            text not null default ''
);
create unique index if not exists app_users_email_key on app_users (lower(email));

-- パスワード変更用URLのトークン。URL に載せるのは乱数そのもの、ここには SHA-256 だけを置く。
create table if not exists app_password_tokens (
  token_hash  text primary key,
  user_id     uuid not null references app_users(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists app_password_tokens_user_idx on app_password_tokens (user_id);

alter table app_users enable row level security;
alter table app_password_tokens enable row level security;

-- アプリのサーバ（service_role）だけが読み書きできるようにする。
do $$
declare sch text := current_schema();
begin
  execute format('grant usage on schema %I to service_role', sch);
  execute format('grant all on all tables in schema %I to service_role', sch);
  execute format('grant all on all sequences in schema %I to service_role', sch);
end $$;
