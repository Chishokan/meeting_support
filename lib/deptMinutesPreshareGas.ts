// 「部門会議事前共有」シートの読み出し（Apps Script 経由）。サーバ専用。
// 事前共有の API（app/api/dept-minutes/preshare）と、Zoom の［ホストとして開始］
//（app/api/zoom/meetings/start）の両方から使う。
//
// ★Apps Script が古いまま（この action を知らない）だと、GAS は既定の「会話ログ」へ1行足して
//   ok:true だけを返す。成功と取り違えないよう、items の有無も確かめる。

import type { PreshareRow } from '@/lib/deptMinutesPreshare';

type GasRow = Record<string, unknown>;

const s = (v: unknown) => String(v ?? '');

export type PreshareListResult =
  // zoomColumns：Apps Script が Zoom の列を読み書きできる版か（古い版だと false）。
  | { ok: true; items: PreshareRow[]; zoomColumns: boolean }
  | { ok: false; reason: string; status: number };

export async function listPreshareRows(): Promise<PreshareListResult> {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return { ok: false, reason: 'not_configured', status: 200 };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'listDeptPreshare', token: process.env.APPS_SCRIPT_TOKEN || '' }),
    });
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.ok === true && Array.isArray(j.items)) {
      const items: PreshareRow[] = (j.items as GasRow[]).map((r) => ({
        id: s(r.id), ts: s(r.ts), campus: s(r.campus), user: s(r.user),
        title: s(r.title), date: s(r.date), place: s(r.place), attendees: s(r.attendees), agenda: s(r.agenda),
        editedAt: s(r.editedAt), editedBy: s(r.editedBy), minutesId: s(r.minutesId),
        // Zoom の列は、Apps Script を更新するまでは返ってこない（空文字になる）。
        zoomAccount: s(r.zoomAccount), zoomMeetingId: s(r.zoomMeetingId),
        zoomJoinUrl: s(r.zoomJoinUrl), zoomPasscode: s(r.zoomPasscode),
      }));
      return { ok: true, items, zoomColumns: j.zoomColumns === true };
    }
    const reason = j && j.ok === true ? 'gas_outdated' : (j && j.reason) || 'upstream_error';
    return { ok: false, reason: s(reason), status: 502 };
  } catch {
    return { ok: false, reason: 'network_error', status: 502 };
  }
}
