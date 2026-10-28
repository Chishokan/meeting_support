'use client';

// 適性検査の画面から API を呼ぶ共通処理と、失敗の理由の言い換え。

import { dbErrorText } from '../core/dbError';

export const REASON_TEXT: Record<string, string> = {
  not_configured: '適性検査の保存先（Supabase）がまだ設定されていません。supabase/README.md の手順で SUPABASE_URL などを設定してください。',
  unauthorized: 'ログインが切れました。ログインし直してください。',
  forbidden: 'この画面は管理部門だけが使えます。',
  not_found: '見つかりませんでした（削除された可能性があります）。',
  version_not_found: 'この版は見つかりませんでした。',
  invalid: '入力を確かめてください。',
  bad_request: '送った内容が正しくありません。画面を読み込み直してください。',
  version_locked: '公開中・終了した版は変えられません。「コピーして下書きを作る」から直してください。',
  version_in_use: 'この版で受けた受検があるため消せません。',
  already_done: 'この受検はもう完了しています。',
  revoked: 'この受検URLは取り消されています。',
  expired: '受検URLの有効期限が切れています。',
  no_consent: '先に同意の画面を済ませてください。',
  no_published_version: '公開中の版がありません。「設問・判定基準」の画面で版を公開してください。',
  rules_missing: '判定基準がそろっていない職種があります。',
  no_active_questions: '使う設問が1問もありません。',
  unanswered: '答えていない設問があります。',
  network_error: '通信できませんでした。電波のよい所でもう一度試してください。',
  unknown_error: '思わぬエラーが起きました。少し時間をおいてもう一度試してください。',
};

export function reasonText(r: string): string {
  if (r.startsWith('db_error')) {
    const [, code = '', msg = ''] = r.split('|');
    return dbErrorText(code, msg);
  }
  return REASON_TEXT[r.split('|')[0]] ?? `読み書きに失敗しました（${r}）。`;
}

export type ApiFail = { ok: false; reason: string; errors?: string[] };

/** JSON の API を呼ぶ。失敗は { ok:false, reason, errors? } にそろえる。 */
export async function api<T extends object>(
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<({ ok: true } & T) | ApiFail> {
  try {
    const res = await fetch(url, {
      method: init?.method ?? (init?.body ? 'POST' : 'GET'),
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
    const j = await res.json().catch(() => null);
    if (!j) return { ok: false, reason: 'network_error' };
    return j;
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}

/** 失敗をそのまま画面に出す一文にする（入力チェックの指摘があればそれを優先）。 */
export const failText = (f: ApiFail) => (f.errors?.length ? f.errors.join(' ') : reasonText(f.reason));

/** ISO の日時 → 「2026/10/08 14:05」（日本時間）。 */
export function jpDateTime(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}/${g('month')}/${g('day')} ${g('hour')}:${g('minute')}`;
}

/** ISO の日時 → 「2026/10/08」（日本時間）。 */
export const jpDate = (v: string | null | undefined) => jpDateTime(v).slice(0, 10);
