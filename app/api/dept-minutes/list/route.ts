import { getSession } from '@/lib/auth';
import { callGas, gasErrorStatus, gasItems } from '@/lib/gas';

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
  place: string;
  attendees: string;
  agenda: string; // 入力時に登録した「予定していた議題」
  minutes: string;
  quality: string;
};

const s = (v: unknown) => String(v ?? '');

export async function GET(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized', items: [] }, { status: 401 });

  const scope = new URL(req.url).searchParams.get('scope') === 'minutes' ? 'minutes' : 'decisions';
  const r = await callGas(scope === 'minutes' ? 'listDeptMinutes' : 'listDeptDecisions');
  if (!r.ok) return Response.json({ ...r, items: [] }, { status: gasErrorStatus(r.reason) });

  const rows = gasItems(r.data);
  if (scope === 'minutes') {
    const items: MinutesRow[] = rows.map((row) => ({
      ts: s(row.ts), campus: s(row.campus), user: s(row.user), title: s(row.title),
      date: s(row.date), place: s(row.place), attendees: s(row.attendees), agenda: s(row.agenda),
      minutes: s(row.minutes), quality: s(row.quality),
    }));
    return Response.json({ ok: true, items });
  }
  const items: DecisionRow[] = rows.map((row) => ({
    ts: s(row.ts), campus: s(row.campus), user: s(row.user), meeting: s(row.meeting),
    date: s(row.date), title: s(row.title), detail: s(row.detail), reason: s(row.reason),
    owner: s(row.owner), due: s(row.due), related: s(row.related),
  }));
  return Response.json({ ok: true, items });
}
