import { getSession } from '@/lib/auth';
import { ADMIN_CAMPUS, STAFF } from '@/lib/staff';
import { DEFAULT_PROGRESS_DEPT_ITEMS } from '@/lib/progressPrompt';

export const runtime = 'nodejs';
export const maxDuration = 30;

type ItemsMap = Record<string, string[]>;

async function callGas(payload: Record<string, unknown>): Promise<{ ok?: boolean; reason?: string; items?: unknown } | null> {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return null;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: process.env.APPS_SCRIPT_TOKEN || '', ...payload }),
  });
  if (!res.ok) return { ok: false, reason: 'upstream_error' };
  return (await res.json().catch(() => null)) as { ok?: boolean; reason?: string; items?: unknown } | null;
}

// 全部門の現行の定例項目を返す。初期値（デフォルト）に GAS 保存分を上書きしたものを返す。
export async function GET() {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized', items: {} }, { status: 401 });

  const merged: ItemsMap = {};
  for (const g of STAFF) merged[g.campus] = DEFAULT_PROGRESS_DEPT_ITEMS[g.campus] ?? [];

  let configured = !!process.env.APPS_SCRIPT_URL;
  if (configured) {
    try {
      const j = await callGas({ action: 'getProgressItems' });
      const saved = (j && j.ok && j.items && typeof j.items === 'object' ? (j.items as ItemsMap) : {}) || {};
      for (const campus of Object.keys(saved)) {
        if (Array.isArray(saved[campus])) merged[campus] = saved[campus].map((s) => String(s));
      }
    } catch {
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

  if (!process.env.APPS_SCRIPT_URL) return Response.json({ ok: false, reason: 'not_configured' });

  try {
    const j = await callGas({ action: 'saveProgressItems', campus, items });
    if (j && j.ok) return Response.json({ ok: true, items: (j.items as string[]) ?? items });
    return Response.json({ ok: false, reason: j?.reason ?? 'upstream_error' }, { status: 502 });
  } catch {
    return Response.json({ ok: false, reason: 'network_error' }, { status: 502 });
  }
}
