-- Zoom の録画から作った議事録の下書き（文字起こし → 議事録）。
-- 録画が完了したとき（または画面で［録画から議事録をつくる］を押したとき）に、アプリが録画の音声を取り出して
-- 文字起こしし、議事録の下書きまで作ってここに置く。人が画面で確認・保存した議事録は、これまでどおりスプレッドシートに入る。
-- Supabase の SQL Editor に貼り付けて実行する。何度実行しても壊れない。
--
-- ★0001 と同じく、下の2行の chishokan_dev を、dev 用はそのまま、本番用は chishokan_prod に書き換えて、2回実行する。
create schema if not exists chishokan_dev;
set search_path = chishokan_dev;

-- 1行＝Zoom ミーティング1件ぶんの下書き。
-- ★会議の文字起こし全文が入る。アプリは作ってから14日たった行を消す（lib/zoom/minutesStore.ts）。
create table if not exists zoom_minutes_jobs (
  account        text not null,                          -- Zoom アカウント（'1'＝公式1、'2'＝公式2）
  meeting_id     text not null,                          -- Zoom のミーティングID
  recording_uuid text not null default '',               -- 録画した開催回の番号
  preshare_id    text not null default '',               -- 事前共有ID
  campus         text not null default '',               -- 部門
  status         text not null default 'running',        -- running（作成中）/ transcribed（文字起こしまで）/ done / error
  source         text not null default '',               -- 文字起こしの任せ先（openai / gemini / zoom）
  model          text not null default '',               -- 文字起こしに使ったモデル
  attempts       jsonb not null default '[]'::jsonb,     -- 試した任せ先と結果（どれが失敗して予備に回ったか）
  transcript     text not null default '',               -- 文字起こし全文
  minutes        text not null default '',               -- 議事録の下書き（議事録＋会議の質チェック）
  error          text not null default '',               -- 失敗した理由
  audio_bytes    bigint not null default 0,              -- 音声の大きさ
  duration_min   integer not null default 0,             -- 録画の長さ（分）
  started_by     text not null default '',               -- 作らせた人（通知から自動で作ったときは '自動'）
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (account, meeting_id)
);

create index if not exists zoom_minutes_jobs_preshare_idx on zoom_minutes_jobs (preshare_id);

alter table zoom_minutes_jobs enable row level security;

-- アプリのサーバ（service_role）だけが読み書きできるようにする。
do $$
declare sch text := current_schema();
begin
  execute format('grant all on all tables in schema %I to service_role', sch);
end $$;
