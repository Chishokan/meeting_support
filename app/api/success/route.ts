import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 30;

export type SuccessRow = {
  ts: string;
  campus: string;
  user: string;
  title: string;
  action: string;
  result: string;
  point: string;
};

type GasRow = Partial<Record<keyof SuccessRow, unknown>>;

// ダッシュボード用：全部門の成功事例を新しい順に取得する（GAS action:'listSuccess'）。
// 「成功事例」シートは「報告」からの転記時に自動で積み上がる。
export async function GET() {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized', items: [] }, { status: 401 });

  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return Response.json({ ok: false, reason: 'not_configured', items: [] });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'listSuccess', token: process.env.APPS_SCRIPT_TOKEN || '' }),
    });
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.ok === true) {
      const rows: GasRow[] = Array.isArray(j.items) ? j.items : [];
      const items: SuccessRow[] = rows.map((r) => ({
        ts: String(r?.ts ?? ''),
        campus: String(r?.campus ?? ''),
        user: String(r?.user ?? ''),
        title: String(r?.title ?? ''),
        action: String(r?.action ?? ''),
        result: String(r?.result ?? ''),
        point: String(r?.point ?? ''),
      }));
      return Response.json({ ok: true, items });
    }
    return Response.json(
      { ok: false, reason: (j && j.reason) || 'upstream_error', items: [] },
      { status: 502 },
    );
  } catch {
    return Response.json({ ok: false, reason: 'network_error', items: [] }, { status: 502 });
  }
}
