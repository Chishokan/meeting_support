import { getSession } from '@/lib/core/auth';
import type { ShareKind } from '@/lib/shareItems';

export const runtime = 'nodejs';
export const maxDuration = 30;

// ダッシュボード用：全部門の事前共有事項（協議・決裁・報告）を新しい順に返す。
// 「事前共有事項」シートは「報告」からの転記時に自動で積み上がる。
export type ShareRow = {
  ts: string;
  campus: string;
  user: string;
  kind: ShareKind | string;
  title: string;
  background: string;
  point: string;
  opinion: string;
};

type GasRow = Partial<Record<keyof ShareRow, unknown>>;

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
      body: JSON.stringify({ action: 'listShareItems', token: process.env.APPS_SCRIPT_TOKEN || '' }),
    });
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.ok === true) {
      const rows: GasRow[] = Array.isArray(j.items) ? j.items : [];
      const items: ShareRow[] = rows.map((r) => ({
        ts: s(r.ts), campus: s(r.campus), user: s(r.user), kind: s(r.kind),
        title: s(r.title), background: s(r.background), point: s(r.point), opinion: s(r.opinion),
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
