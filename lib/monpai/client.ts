'use client';

// 門配管理の画面から API を呼ぶ共通処理。

import type { MonpaiRecord, MonthSetting, School } from './model';

export type Master = { schools: School[]; settings: MonthSetting[]; backend?: string };

export const REASON_TEXT: Record<string, string> = {
  not_configured: '門配管理の保存先（MONPAI_SCRIPT_URL）がまだ設定されていません。',
  invalid_token: '保存先の合言葉（MONPAI_SCRIPT_TOKEN）が一致していません。',
  upstream_error: '保存先（スプレッドシート）から正しい応答がありませんでした。',
  network_error: '保存先に接続できませんでした。',
  db_error: 'データベースの読み書きに失敗しました。テーブルが作られているか（supabase/migrations の SQL を実行したか）確認してください。',
  not_found: 'この記録は見つかりませんでした（削除された可能性があります）。',
  unauthorized: 'ログインが切れました。ログインし直してください。',
  ai_not_configured: 'AIの設定（ANTHROPIC_API_KEY）がありません。',
  ai_error: 'AIの呼び出しに失敗しました。少し時間をおいてもう一度試してください。',
  ai_bad_output: 'AIの案を読み取れませんでした。もう一度試してください。',
  ai_refused: 'AIが案の作成を断りました。',
  no_schools: 'この地区の学校が学校マスタに登録されていません。',
  forbidden: 'この操作は管理部門だけができます。',
  not_supported: '今の保存先（スプレッドシート）では画面から編集できません。スプレッドシートを直接編集してください。',
};

// データベースのエラー（db_error|コード|文面）を、設定の直し方に言い換える。
function dbErrorText(code: string, msg: string): string {
  const m = msg.toLowerCase();
  if (code === 'PGRST106' || m.includes('schema must be one of') || m.includes('invalid schema')) {
    return 'データベースの区画が公開されていません。Supabase の Project Settings → Data API → Exposed schemas に chishokan_dev（本番は chishokan_prod）が入っているか確認してください。';
  }
  if (code === 'PGRST125' || m.includes('invalid path')) {
    return 'データベースの接続先URLが正しくありません。Vercel の SUPABASE_URL を「https://（プロジェクトID）.supabase.co」だけにしてください（末尾に /rest/v1 などを付けない）。';
  }
  if (code === 'PGRST205' || code === '42P01' || m.includes('could not find the table') || m.includes('does not exist')) {
    return 'データベースに表が見つかりません。Vercel の SUPABASE_SCHEMA の値と、SQL を実行した区画（chishokan_dev / chishokan_prod）が一致しているか確認してください。';
  }
  if (code === '42501' || m.includes('permission denied')) {
    return 'データベースの権限がありません。supabase/migrations の SQL を、その区画でもう一度実行してください（最後に権限を付ける部分があります）。';
  }
  if (m.includes('invalid api key') || m.includes('jwt') || m.includes('unauthorized')) {
    return 'データベースの鍵が正しくありません。Vercel の SUPABASE_SERVICE_ROLE_KEY が service_role（secret）キーになっているか確認してください。';
  }
  return `データベースの読み書きに失敗しました（${code || 'エラー'}：${msg || '詳細なし'}）。`;
}

export const reasonText = (r: string) => {
  if (r.startsWith('db_error')) {
    const [, code = '', msg = ''] = r.split('|');
    return dbErrorText(code, msg);
  }
  return REASON_TEXT[r] ?? `読み書きに失敗しました（${r}）。`;
};

export async function fetchMaster(): Promise<{ ok: true; master: Master } | { ok: false; reason: string }> {
  const j = await fetch('/api/monpai/master', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  if (!j?.ok) return { ok: false, reason: j?.reason ?? 'network_error' };
  return { ok: true, master: { schools: j.schools, settings: j.settings, backend: j.backend } };
}

export async function fetchRecords(months: string[]): Promise<{ ok: true; items: MonpaiRecord[] } | { ok: false; reason: string }> {
  const j = await fetch(`/api/monpai/records?months=${months.join(',')}`, { cache: 'no-store' })
    .then((r) => r.json()).catch(() => null);
  if (!j?.ok) return { ok: false, reason: j?.reason ?? 'network_error' };
  return { ok: true, items: j.items };
}

export async function saveRecordApi(
  rec: Partial<MonpaiRecord>,
): Promise<{ ok: true; item: MonpaiRecord } | { ok: false; reason: string; errors?: string[] }> {
  const j = await fetch('/api/monpai/records', {
    method: rec.id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rec),
  }).then((r) => r.json()).catch(() => null);
  if (!j?.ok) return { ok: false, reason: j?.reason ?? 'network_error', errors: j?.errors };
  return { ok: true, item: j.item };
}

export async function deleteRecordApi(id: string): Promise<{ ok: boolean; reason?: string }> {
  const j = await fetch(`/api/monpai/records?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    .then((r) => r.json()).catch(() => null);
  return j?.ok ? { ok: true } : { ok: false, reason: j?.reason ?? 'network_error' };
}

export type StockRow = import('./model').MaterialStock;
export type MovementRow = import('./model').MaterialMovement;

export async function fetchMaterials(): Promise<{ ok: true; items: StockRow[]; movements: MovementRow[] } | { ok: false; reason: string }> {
  const j = await fetch('/api/monpai/materials', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  if (!j?.ok) return { ok: false, reason: j?.reason ?? 'network_error' };
  return { ok: true, items: j.items, movements: j.movements };
}

export async function postMaterial(body: Record<string, unknown>): Promise<{ ok: boolean; reason?: string; errors?: string[] }> {
  const j = await fetch('/api/monpai/materials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json()).catch(() => null);
  return j?.ok ? { ok: true } : { ok: false, reason: j?.reason ?? 'network_error', errors: j?.errors };
}

export type PlanItem = import('./plan').PlanItem;

export async function draftPlanApi(district: string, month: string): Promise<
  { ok: true; summary: string; items: PlanItem[]; dropped: number } | { ok: false; reason: string }
> {
  const j = await fetch('/api/monpai/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ district, month }),
  }).then((r) => r.json()).catch(() => null);
  if (!j?.ok) return { ok: false, reason: j?.reason ?? 'network_error' };
  return j;
}

export async function masterApi(method: 'POST' | 'DELETE', body: Record<string, unknown>): Promise<{ ok: boolean; reason?: string; errors?: string[] }> {
  const init: RequestInit = method === 'POST'
    ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method };
  const url = method === 'POST' ? '/api/monpai/schools' : `/api/monpai/schools?${new URLSearchParams(body as Record<string, string>)}`;
  const j = await fetch(url, init).then((r) => r.json()).catch(() => null);
  return j?.ok ? { ok: true } : { ok: false, reason: j?.reason ?? 'network_error', errors: j?.errors };
}
