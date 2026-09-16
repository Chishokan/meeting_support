import { getSession } from '@/lib/auth';
import { callGas, gasErrorStatus, isGasConfigured } from '@/lib/gas';
import { ADMIN_CAMPUS, STAFF } from '@/lib/staff';
import { DEFAULT_PROGRESS_DEPT_ITEMS } from '@/lib/progressPrompt';

export const runtime = 'nodejs';
export const maxDuration = 30;

type ItemsMap = Record<string, string[]>;

// 全部門の現行の定例項目を返す。初期値（デフォルト）に GAS 保存分を上書きしたものを返す。
export async function GET() {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized', items: {} }, { status: 401 });

  const merged: ItemsMap = {};
  for (const g of STAFF) merged[g.campus] = DEFAULT_PROGRESS_DEPT_ITEMS[g.campus] ?? [];

  let configured = isGasConfigured();
  if (configured) {
    const r = await callGas('getProgressItems');
    if (r.ok) {
      const saved = (r.data.items && typeof r.data.items === 'object' ? (r.data.items as ItemsMap) : {}) || {};
      for (const campus of Object.keys(saved)) {
        if (Array.isArray(saved[campus])) merged[campus] = saved[campus].map((s) => String(s));
      }
    } else if (r.reason === 'network_error') {
      configured = false;
    }
  }
  return Response.json({ ok: true, items: merged, isAdmin: session.campus === ADMIN_CAMPUS, configured });
}

// 指定部門の定例項目を保存（管理部門のみ）。
export async function PUT(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (session.campus !== ADMIN_CAMPUS) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const campus = String(body?.campus ?? '').trim();
  const items = Array.isArray(body?.items) ? body.items.map((s: unknown) => String(s)) : null;
  if (!campus || !STAFF.some((g) => g.campus === campus)) {
    return Response.json({ ok: false, reason: 'bad_campus' }, { status: 400 });
  }
  if (!items) return Response.json({ ok: false, reason: 'bad_items' }, { status: 400 });

  const r = await callGas('saveProgressItems', { campus, items });
  if (!r.ok) return Response.json(r, { status: gasErrorStatus(r.reason) });
  return Response.json({ ok: true, items: (r.data.items as string[]) ?? items });
}
