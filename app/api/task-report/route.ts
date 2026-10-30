import { getSession } from '@/lib/core/auth';
import { campusesFor } from '@/lib/numberReports';
import { cleanReport, reportRow, SHEET_HEADERS, TASK_REPORT_DEPT } from '@/lib/taskReport';

export const runtime = 'nodejs';
export const maxDuration = 30;

// 重要タスク報告（小中等部の週次）をスプレッドシートへ記録する。
// Apps Script（APPS_SCRIPT_URL）に action:'saveTaskReport' を送り、「重要タスク報告」シートに1行追加する。
// 出し直すと追記になる（評価では対象週×校舎の新しいほうを使う）。
export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (session.campus !== TASK_REPORT_DEPT) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const r = cleanReport(body, campusesFor(TASK_REPORT_DEPT));
  if (!r.ok) return Response.json(r, { status: 400 });

  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return Response.json({ ok: false, reason: 'not_configured' });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveTaskReport',
        token: process.env.APPS_SCRIPT_TOKEN || '',
        ts: new Date().toISOString(),
        campus: session.campus,
        user: session.name,
        headers: SHEET_HEADERS,
        row: reportRow(r.report),
      }),
    });
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.ok === true && j.saved === 'taskReport') return Response.json({ ok: true });
    // 再デプロイ前の Apps Script は未知の action を会話ログに書いて ok を返すので、印が無ければ保存されていない
    if (res.ok && j && j.ok === true) return Response.json({ ok: false, reason: 'not_deployed' }, { status: 502 });
    return Response.json({ ok: false, reason: (j && j.reason) || 'upstream_error' }, { status: 502 });
  } catch {
    return Response.json({ ok: false, reason: 'network_error' }, { status: 502 });
  }
}
