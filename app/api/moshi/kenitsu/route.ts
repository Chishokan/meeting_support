import { guard } from '@/lib/moshi/api';
import { MAX_KEN_ROWS, cleanKenItem, type KenitsuResult } from '@/lib/moshi/model';
import { deleteKenitsu, saveKenitsu } from '@/lib/moshi/store';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 県一斉模試の成績の取り込み。{ examId, examName, date, items: [{ campus, examNo, gender, naishin, stats, choices }] }。
// ★氏名は受け取らない（成績は「校舎＋受験番号」で名簿と結び付く）。同じ examId を送り直すと、その回の分を置きかえる。
export async function POST(req: Request) {
  const g = guard();
  if ('res' in g) return g.res;
  const body = (await req.json().catch(() => ({}))) as { examId?: unknown; examName?: unknown; date?: unknown; items?: unknown };
  const examName = String(body.examName ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const date = String(body.date ?? '').trim();
  if (!examName) return Response.json({ ok: false, reason: 'no_name' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ ok: false, reason: 'bad_date' }, { status: 400 });
  const examId = /^ken-[\w-]{4,40}$/.test(String(body.examId ?? '')) ? String(body.examId) : `ken-${date}`;
  const raw = Array.isArray(body.items) ? body.items : [];
  if (!raw.length) return Response.json({ ok: false, reason: 'no_rows' }, { status: 400 });
  if (raw.length > MAX_KEN_ROWS) return Response.json({ ok: false, reason: 'too_many' }, { status: 400 });
  const items: KenitsuResult[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    const c = cleanKenItem(x, { examId, examName, date });
    if (!c) return Response.json({ ok: false, reason: 'bad_row' }, { status: 400 });
    const key = `${c.campus}|${c.examNo}`;
    if (seen.has(key)) return Response.json({ ok: false, reason: 'duplicate', detail: `${c.campus} ${c.examNo}` }, { status: 400 });
    seen.add(key);
    items.push(c);
  }
  const r = await saveKenitsu(examId, items, g.session.name);
  if (!r.ok) return Response.json(r, { status: 502 });
  return Response.json({ ok: true, examId, count: r.count });
}

export async function DELETE(req: Request) {
  const g = guard();
  if ('res' in g) return g.res;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^ken-[\w-]{4,40}$/.test(id)) return Response.json({ ok: false, reason: 'bad_id' }, { status: 400 });
  const r = await deleteKenitsu(id);
  if (!r.ok) return Response.json(r, { status: 502 });
  return Response.json({ ok: true });
}
