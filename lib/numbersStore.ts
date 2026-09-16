// 「数値報告」の保存・取得（Apps Script 経由でスプレッドシート「夏期数値」を読み書き）。
// APPS_SCRIPT_URL 未設定でもアプリは壊れない（保存は not_configured、取得は空配列）。

import { callGas, gasItems } from './gas';
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
  const r = await callGas('saveNumbers', {
    ts: new Date().toISOString(),
    dept,
    campus,
    user,
    headers: NUMBER_SHEET_HEADERS,
    row: valuesToRow(values),
  });
  return r.ok ? { ok: true } : r;
}

// 新しい順に返す。dept を渡すとその部門だけに絞る。
export async function listNumbers(dept?: string): Promise<NumberEntry[]> {
  const r = await callGas('listNumbers');
  if (!r.ok) return [];
  const entries: NumberEntry[] = gasItems(r.data).map((row) => ({
    ts: String(row?.['日時'] ?? ''),
    dept: String(row?.['部門'] ?? ''),
    campus: String(row?.['校舎'] ?? ''),
    user: String(row?.['入力者'] ?? ''),
    values: rowToValues(row ?? {}),
  }));
  return dept ? entries.filter((e) => e.dept === dept) : entries;
}
