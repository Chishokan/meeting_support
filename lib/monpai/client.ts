'use client';

// 門配管理の画面から API を呼ぶ共通処理。

import type { MonpaiRecord, MonthSetting, School } from './model';

export type Master = { schools: School[]; settings: MonthSetting[]; backend?: string };

export const REASON_TEXT: Record<string, string> = {
  not_configured: '門配管理の保存先（MONPAI_SCRIPT_URL）がまだ設定されていません。',
  invalid_token: '保存先の合言葉（MONPAI_SCRIPT_TOKEN）が一致していません。',
  upstream_error: '保存先（スプレッドシート）から正しい応答がありませんでした。',
  network_error: '保存先に接続できませんでした。',
  not_found: 'この記録は見つかりませんでした（削除された可能性があります）。',
  unauthorized: 'ログインが切れました。ログインし直してください。',
};

export const reasonText = (r: string) => REASON_TEXT[r] ?? `読み書きに失敗しました（${r}）。`;

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
