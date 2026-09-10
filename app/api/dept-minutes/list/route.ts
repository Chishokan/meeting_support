import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 30;

// 部門横断の決め事の見える化。「部門決定事項」シートを新しい順に返す。
// ?scope=minutes を付けると、議事録そのものの一覧（本文込み）を返す。
export type DecisionRow = {
  ts: string;
  campus: string;
  user: string;
  meeting: string; // 会議名
  date: string; // 開催日
  title: string;
  detail: string;
  reason: string;
  owner: string;
  due: string;
  related: string; // 関係部門
};

export type MinutesRow = {
  ts: string;
  campus: string;
  user: string;
  title: string;
  date: string;
  attendees: string;
  minutes: string;
  quality: string;
};

type GasRow = Record<string, unknown>;

const s = (v: unknown) => String(v ?? '');

export async function GET(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized', items: [] }, { status: 401 });

  const scope = new URL(req.url).searchParams.get('scope') === 'minutes' ? 'minutes' : 'decisions';
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return Response.json({ ok: false, reason: 'not_configured', items: [] });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: scope === 'minutes' ? 'listDeptMinutes' : 'listDeptDecisions',
        token: process.env.APPS_SCRIPT_TOKEN || '',
      }),
    });
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.ok === true) {
      const rows: GasRow[] = Array.isArray(j.items) ? j.items : [];
      if (scope === 'minutes') {
        const items: MinutesRow[] = rows.map((r) => ({
          ts: s(r.ts), campus: s(r.campus), user: s(r.user), title: s(r.title),
          date: s(r.date), attendees: s(r.attendees), minutes: s(r.minutes), quality: s(r.quality),
        }));
        return Response.json({ ok: true, items });
      }
      const items: DecisionRow[] = rows.map((r) => ({
        ts: s(r.ts), campus: s(r.campus), user: s(r.user), meeting: s(r.meeting),
        date: s(r.date), title: s(r.title), detail: s(r.detail), reason: s(r.reason),
        owner: s(r.owner), due: s(r.due), related: s(r.related),
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
