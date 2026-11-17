import { guard } from '@/lib/eventList/api';
import { loadAll, saveTracks, type TrackSave } from '@/lib/eventList/store';
import { cleanTrackFields } from '@/lib/eventList/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// イベント申込管理（/event）。
//   GET  … 名簿・声掛けの記録・申込フォームの回答をまとめて返す（画面側で校舎に絞り、集計する）
//   POST … { items: [{ key, campus, name, fields }] } 声掛けの記録を保存する。fields は変えた項目だけ
//          （同じ生徒のチラシと反応を別の人が同時に入れても消えない）。まとめて付けるときは複数件
export async function GET() {
  const g = guard();
  if ('res' in g) return g.res;
  const r = await loadAll();
  return Response.json(r, { status: r.ok || r.reason === 'not_configured' ? 200 : 502 });
}

export async function POST(req: Request) {
  const g = guard();
  if ('res' in g) return g.res;
  const b = (await req.json().catch(() => ({}))) as { items?: unknown };
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 500) {
    return Response.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }
  const items: TrackSave[] = [];
  for (const raw of b.items as Record<string, unknown>[]) {
    const key = String(raw?.key ?? '').trim();
    const fields = cleanTrackFields(raw?.fields);
    if (!key || key.length > 200 || !Object.keys(fields).length) {
      return Response.json({ ok: false, reason: 'bad_request' }, { status: 400 });
    }
    items.push({ key, campus: String(raw?.campus ?? '').slice(0, 50), name: String(raw?.name ?? '').slice(0, 100), fields });
  }
  const r = await saveTracks(items, g.session.name);
  return Response.json(r, { status: r.ok ? 200 : 502 });
}
