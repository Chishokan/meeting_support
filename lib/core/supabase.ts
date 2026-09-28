// Supabase（データベース）への接続。サーバ専用（API ルートからだけ使う）。
//
// service_role キーは RLS（行単位のアクセス制御）を通らない強い鍵なので、ブラウザに渡してはいけない。
// 環境変数は NEXT_PUBLIC_ を付けずに登録する（付けるとブラウザ向けのコードに埋め込まれてしまう）。
//   SUPABASE_URL              … 例 https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY … Project Settings → API Keys の service_role（secret）
//   SUPABASE_SCHEMA           … テーブルを置いた区画（スキーマ）。dev＝chishokan_dev、本番＝chishokan_prod
//                               1つの Supabase プロジェクトに dev と本番を同居させるために分けている
// 未設定なら null を返し、各アプリは従来の保存先（スプレッドシート）を使う。

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cached: SupabaseClient<any, any, any> | null | undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function supabaseAdmin(): SupabaseClient<any, any, any> | null {
  if (cached !== undefined) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return (cached = null);
  const schema = process.env.SUPABASE_SCHEMA || 'public';
  cached = createClient(url, key, {
    db: { schema },
    auth: { persistSession: false, autoRefreshToken: false },
    // Next.js は fetch の結果を勝手に使い回すことがあるので、データベースの読み書きは毎回取りに行かせる
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
  return cached;
}

/** timestamptz → 画面に出す「2026/09/28 14:05」（日本時間）。 */
export function jpDateTime(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}/${g('month')}/${g('day')} ${g('hour')}:${g('minute')}`;
}
