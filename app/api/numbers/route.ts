import { getSession } from '@/lib/core/auth';
import { listNumbers, saveNumbers } from '@/lib/numbersStore';
import { isReportKind, latestByCampus, type NumberValues } from '@/lib/numberReports';

export const runtime = 'nodejs';
export const maxDuration = 30;

// 自部門の登録済み数値（対象期間×校舎ごとに最新1件）を返す。?kind=monthly|season
export async function GET(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized', items: [] }, { status: 401 });

  const kind = new URL(req.url).searchParams.get('kind');
  if (!isReportKind(kind)) return Response.json({ ok: false, reason: 'bad_kind', items: [] }, { status: 400 });

  const r = await listNumbers(kind, session.campus);
  if (!r.ok) return Response.json(r);
  return Response.json({ ok: true, items: latestByCampus(r.items) });
}

// 「数値報告」フォームからの登録。同じ対象期間・校舎で何度でも送信でき、最新の1件が採用される。
export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const kind = body?.kind;
  const period = String(body?.period ?? '').trim();
  const dept = String(body?.dept ?? '').trim();
  const campus = String(body?.campus ?? '').trim();
  const raw = body?.values;
  if (!isReportKind(kind)) return Response.json({ ok: false, reason: 'bad_kind' }, { status: 400 });
  if (!period) return Response.json({ ok: false, reason: 'missing_period' }, { status: 400 });
  if (!dept || !campus) return Response.json({ ok: false, reason: 'missing_campus' }, { status: 400 });

  const values: NumberValues = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) values[k] = String(v ?? '');
  }

  const result = await saveNumbers({ kind, period, dept, campus, user: session.name, values });
  if (result.ok) return Response.json({ ok: true });
  return Response.json(result, { status: result.reason === 'not_configured' ? 200 : 502 });
}
