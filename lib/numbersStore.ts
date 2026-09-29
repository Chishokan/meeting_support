// 「数値報告」の保存・取得（Apps Script 経由でスプレッドシート「月次数値」「講習数値」を読み書き）。
// APPS_SCRIPT_URL 未設定でもアプリは壊れない（保存は not_configured、取得は空配列）。
//
// Apps Script が古い（saveNumberReport / listNumberReports を知らない）と、
// 未知の action は会話ログ扱いで ok:true だけが返る。応答に sheet が無ければ
// apps_script_outdated として扱い、「登録できた」と誤って表示しないようにする。

import {
  NUMBER_FORMS,
  rowToValues,
  sheetHeaders,
  valuesToRow,
  type NumberEntry,
  type NumberValues,
  type ReportKind,
} from './numberReports';

type SaveArgs = {
  kind: ReportKind;
  period: string;
  dept: string;
  campus: string;
  user: string;
  values: NumberValues;
};

export async function saveNumbers({ kind, period, dept, campus, user, values }: SaveArgs): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return { ok: false, reason: 'not_configured' };
  const form = NUMBER_FORMS[kind];

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveNumberReport',
        token: process.env.APPS_SCRIPT_TOKEN || '',
        sheet: form.sheet,
        headers: sheetHeaders(form),
        row: [new Date().toISOString(), period, dept, campus, user, ...valuesToRow(form, values)],
      }),
    });
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.ok === true) {
      return j.sheet === form.sheet ? { ok: true } : { ok: false, reason: 'apps_script_outdated' };
    }
    return { ok: false, reason: (j && j.reason) || 'upstream_error' };
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}

export type ListResult = { ok: true; items: NumberEntry[] } | { ok: false; reason: string; items: [] };

// 新しい順に返す。dept を渡すとその部門だけに絞る。
export async function listNumbers(kind: ReportKind, dept?: string): Promise<ListResult> {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return { ok: false, reason: 'not_configured', items: [] };
  const form = NUMBER_FORMS[kind];

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'listNumberReports',
        token: process.env.APPS_SCRIPT_TOKEN || '',
        sheet: form.sheet,
      }),
      cache: 'no-store',
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || j.ok !== true) return { ok: false, reason: (j && j.reason) || 'upstream_error', items: [] };
    if (!Array.isArray(j.items)) return { ok: false, reason: 'apps_script_outdated', items: [] };
    const entries: NumberEntry[] = j.items.map((r: Record<string, unknown>) => ({
      ts: String(r?.['日時'] ?? ''),
      period: String(r?.['対象'] ?? ''),
      dept: String(r?.['部門'] ?? ''),
      campus: String(r?.['校舎'] ?? ''),
      user: String(r?.['入力者'] ?? ''),
      values: rowToValues(form, r ?? {}),
    }));
    return { ok: true, items: dept ? entries.filter((e) => e.dept === dept) : entries };
  } catch {
    return { ok: false, reason: 'network_error', items: [] };
  }
}
