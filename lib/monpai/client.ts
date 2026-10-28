'use client';

// 門配管理の画面から API を呼ぶ共通処理。

import type { MonpaiRecord, MonpaiStaff, MonthSetting, School } from './model';
import { dbErrorText } from '../core/dbError';

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
  not_mine: 'この門配はあなたの担当ではありません。担当が違うときは社員に連絡してください。',
  future: 'まだ日付が来ていない門配は報告できません。',
};

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
  { ok: true; summary: string; items: PlanItem[]; dropped: number; basis?: { months: number; visits: number; staff: number } } | { ok: false; reason: string }
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

// ---- 門配スタッフ ------------------------------------------------------------

/** 名簿（社員の画面「スタッフ」用）。 */
export async function fetchStaff(): Promise<{ ok: true; items: MonpaiStaff[] } | { ok: false; reason: string }> {
  const j = await fetch('/api/monpai/staff', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  if (!j?.ok) return { ok: false, reason: j?.reason ?? 'network_error' };
  return { ok: true, items: j.items };
}

export async function staffApi(method: 'POST' | 'DELETE', body: Record<string, unknown>): Promise<{ ok: boolean; reason?: string; errors?: string[] }> {
  const init: RequestInit = method === 'POST'
    ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method };
  const url = method === 'POST' ? '/api/monpai/staff' : `/api/monpai/staff?${new URLSearchParams(body as Record<string, string>)}`;
  const j = await fetch(url, init).then((r) => r.json()).catch(() => null);
  return j?.ok ? { ok: true } : { ok: false, reason: j?.reason ?? 'network_error', errors: j?.errors };
}

/** スタッフ専用画面：自分の担当の記録。 */
export async function fetchMyRecords(months: string[]): Promise<{ ok: true; items: MonpaiRecord[] } | { ok: false; reason: string }> {
  const j = await fetch(`/api/monpai-staff/records?months=${months.join(',')}`, { cache: 'no-store' })
    .then((r) => r.json()).catch(() => null);
  if (!j?.ok) return { ok: false, reason: j?.reason ?? 'network_error' };
  return { ok: true, items: j.items };
}

export type ReportInput = { done: number | null; reason: string; memo: string; cancel: boolean };
export type ReportResult = { ok: true; item: MonpaiRecord } | { ok: false; reason: string; errors?: string[] };

/** スタッフ専用画面：実績の報告。計画の値はサーバ側の記録を使うので送らない。 */
export async function reportMyRecord(r: MonpaiRecord, input: ReportInput): Promise<ReportResult> {
  const j = await fetch('/api/monpai-staff/records', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: r.id, month: r.date.slice(0, 7), ...input }),
  }).then((x) => x.json()).catch(() => null);
  if (!j?.ok) return { ok: false, reason: j?.reason ?? 'network_error', errors: j?.errors };
  return { ok: true, item: j.item };
}
