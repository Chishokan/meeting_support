// 「数値報告」の保存・取得（Apps Script 経由でスプレッドシート「夏期数値」を読み書き）。
// APPS_SCRIPT_URL 未設定でもアプリは壊れない（保存は not_configured、取得は空配列）。

import {
  NUMBER_SHEET_HEADERS,
  rowToValues,
  valuesToRow,
  type NumberEntry,
  type NumberValues,
} from './summerNumbers';

type SaveArgs = { dept: string; campus: string; user: string; values: NumberValues };

export async function saveNumbers({ dept, campus, user, values }: SaveArgs): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return { ok: false, reason: 'not_configured' };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveNumbers',
        token: process.env.APPS_SCRIPT_TOKEN || '',
        ts: new Date().toISOString(),
        dept,
        campus,
        user,
        headers: NUMBER_SHEET_HEADERS,
        row: valuesToRow(values),
      }),
    });
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.ok === true) return { ok: true };
    return { ok: false, reason: (j && j.reason) || 'upstream_error' };
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}

// 新しい順に返す。dept を渡すとその部門だけに絞る。
export async function listNumbers(dept?: string): Promise<NumberEntry[]> {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return [];

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'listNumbers', token: process.env.APPS_SCRIPT_TOKEN || '' }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || j.ok !== true || !Array.isArray(j.items)) return [];
    const entries: NumberEntry[] = j.items.map((r: Record<string, unknown>) => ({
      ts: String(r?.['日時'] ?? ''),
      dept: String(r?.['部門'] ?? ''),
      campus: String(r?.['校舎'] ?? ''),
      user: String(r?.['入力者'] ?? ''),
      values: rowToValues(r ?? {}),
    }));
    return dept ? entries.filter((e) => e.dept === dept) : entries;
  } catch {
    return [];
  }
}
