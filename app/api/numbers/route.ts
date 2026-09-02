import { getSession } from '@/lib/auth';
import { listNumbers, saveNumbers } from '@/lib/numbersStore';
import { latestByCampus, type NumberValues } from '@/lib/summerNumbers';

export const runtime = 'nodejs';
export const maxDuration = 30;

// 自部門の登録済み数値（校舎ごとに最新1件）を返す。
export async function GET() {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized', items: [] }, { status: 401 });
  if (!process.env.APPS_SCRIPT_URL) return Response.json({ ok: false, reason: 'not_configured', items: [] });

  const items = latestByCampus(await listNumbers(session.campus));
  return Response.json({ ok: true, items });
}

// 「数値報告」フォームからの登録。1校舎につき何度でも送信でき、最新の1件が採用される。
export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const dept = String(body?.dept ?? '').trim();
  const campus = String(body?.campus ?? '').trim();
  const raw = body?.values;
  if (!dept || !campus) return Response.json({ ok: false, reason: 'missing_campus' }, { status: 400 });

  const values: NumberValues = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) values[k] = String(v ?? '');
  }

  const result = await saveNumbers({ dept, campus, user: session.name, values });
  if (result.ok) return Response.json({ ok: true });
  return Response.json(result, { status: result.reason === 'not_configured' ? 200 : 502 });
}
