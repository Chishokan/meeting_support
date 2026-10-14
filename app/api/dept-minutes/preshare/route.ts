import { getSession } from '@/lib/core/auth';
import { missingForPreshare, type PreshareRow } from '@/lib/deptMinutesPreshare';

export const runtime = 'nodejs';
export const maxDuration = 30;

// 部門会議の事前共有（会議の前に、会議情報と議題・レジュメを全部門へ出しておく）。
//   GET  … 事前共有の一覧（新しい順）。ダッシュボードと「部門会議議事録」画面で使う
//   POST … 事前共有の保存。id を添えると、その事前共有を上書きする
// 保存先は Apps Script の「部門会議事前共有」シート（saveDeptPreshare_ / listDeptPreshare_）。
//
// ★Apps Script が古いまま（この action を知らない）だと、GAS は既定の「会話ログ」へ1行足して
//   ok:true だけを返す。成功と取り違えないよう、返ってきた id / items の有無も確かめる。

type GasRow = Record<string, unknown>;

const s = (v: unknown) => String(v ?? '');

export async function GET() {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized', items: [] }, { status: 401 });

  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return Response.json({ ok: false, reason: 'not_configured', items: [] });

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
      }));
      return Response.json({ ok: true, items });
    }
    const reason = j && j.ok === true ? 'gas_outdated' : (j && j.reason) || 'upstream_error';
    return Response.json({ ok: false, reason, items: [] }, { status: 502 });
  } catch {
    return Response.json({ ok: false, reason: 'network_error', items: [] }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const raw = (body?.meta ?? {}) as Record<string, unknown>;
  const meta = {
    title: s(raw.title).trim(),
    date: s(raw.date).trim(),
    place: s(raw.place).trim(),
    attendees: s(raw.attendees).trim(),
    agenda: s(raw.agenda).trim(),
  };
  const missing = missingForPreshare(meta);
  if (missing.length > 0) return Response.json({ ok: false, reason: 'empty', missing }, { status: 400 });

  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return Response.json({ ok: false, reason: 'not_configured' });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveDeptPreshare',
        token: process.env.APPS_SCRIPT_TOKEN || '',
        id: s(body?.id),
        campus: session.campus,
        user: session.name,
        ...meta,
      }),
    });
    // GAS(ContentService)は失敗時も HTTP 200 を返すため、本文の ok/reason を必ず確認する。
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.ok === true && j.id) {
      return Response.json({ ok: true, id: s(j.id), updated: j.updated === true, ts: s(j.ts) });
    }
    const reason = j && j.ok === true ? 'gas_outdated' : (j && j.reason) || 'upstream_error';
    return Response.json({ ok: false, reason }, { status: 502 });
  } catch {
    return Response.json({ ok: false, reason: 'network_error' }, { status: 502 });
  }
}
