// 部門会議の議事録をスプレッドシートに保存する（サーバ専用）。
// 画面の［保存］（app/api/dept-minutes/save）と、Zoom の録画からの自動保存（lib/zoom/autoMinutes.ts）の両方が使う。
// Apps Script（APPS_SCRIPT_URL）に action:'saveDeptMinutes' を送り、GAS 側で
//   ・「部門会議議事録」シートに1会議1行
//   ・「部門決定事項」シートに1決定1行（部門横断の見える化のもと）
// を記録する。

import { extractDecisions, extractMinutes, extractQuality } from '@/lib/deptMinutesParse';

export type SaveInput = {
  id?: string; // 既存の議事録を直して保存し直すときだけ付く（無ければ新規）
  preshareId?: string; // 事前共有した会議なら、その事前共有に議事録を結び付ける
  campus: string;
  user: string;
  meta: { title?: unknown; date?: unknown; place?: unknown; attendees?: unknown; agenda?: unknown };
  content: string; // 議事録＋会議の質チェックの全文
  note?: string; // 議事録の先頭に入れる注記（自動で作ったことを読む人に伝える）
};

export type SaveResult =
  | { ok: true; id: string; updated: boolean; decisions: number }
  | { ok: false; reason: string; decisions: number };

export async function saveMinutesToSheet(input: SaveInput): Promise<SaveResult> {
  // 決定事項は保存する最終テキストから抜き出す（人が直した内容がそのまま集計に載る）。
  const body = extractMinutes(input.content);
  const minutes = input.note ? `${input.note}\n\n${body}` : body;
  const quality = extractQuality(input.content);
  const decisions = extractDecisions(input.content);

  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return { ok: false, reason: 'not_configured', decisions: decisions.length };

  const payload = {
    action: 'saveDeptMinutes',
    id: input.id ?? '',
    preshareId: input.preshareId ?? '',
    token: process.env.APPS_SCRIPT_TOKEN || '',
    ts: new Date().toISOString(),
    campus: input.campus,
    user: input.user,
    title: String(input.meta.title ?? ''),
    date: String(input.meta.date ?? ''),
    place: String(input.meta.place ?? ''),
    attendees: String(input.meta.attendees ?? ''),
    agenda: String(input.meta.agenda ?? ''),
    minutes,
    quality,
    decisions,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    // GAS(ContentService)は失敗時も HTTP 200 を返すため、本文の ok/reason を必ず確認する。
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.ok === true) {
      return { ok: true, id: String(j.id ?? ''), updated: j.updated === true, decisions: decisions.length };
    }
    return { ok: false, reason: (j && j.reason) || 'upstream_error', decisions: decisions.length };
  } catch {
    return { ok: false, reason: 'network_error', decisions: decisions.length };
  }
}
