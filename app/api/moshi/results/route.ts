import { examById, guard } from '@/lib/moshi/api';
import { cleanResult } from '@/lib/moshi/model';
import { deleteResults, RESULT_FIELDS, saveResults, type ResultField, type SaveRow } from '@/lib/moshi/store';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_ROWS = 200;

// 成績（受験者1人1行）の保存。{ examId, rows: [{ row, fields }] }。
// fields はこの保存で変えた項目（campus・examNo・name・gender・choices・comment・ja/en/ma/so/sc）。
// 新しい行は fields を null にして行まるごと送る。
export async function POST(req: Request) {
  const g = guard();
  if ('res' in g) return g.res;
  const body = (await req.json().catch(() => ({}))) as { examId?: string; rows?: { row?: unknown; fields?: unknown }[] };
  const list = Array.isArray(body.rows) ? body.rows : [];
  if (!list.length) return Response.json({ ok: true, items: [] });
  if (list.length > MAX_ROWS) return Response.json({ ok: false, reason: 'too_many' }, { status: 400 });

  const exam = await examById(String(body.examId ?? ''));
  if (exam === 'error') return Response.json({ ok: false, reason: 'upstream_error' }, { status: 502 });
  if (!exam) return Response.json({ ok: false, reason: 'exam_not_found' }, { status: 404 });

  const rows: SaveRow[] = [];
  for (const item of list) {
    const c = cleanResult(item?.row, exam);
    if (!c.ok) return Response.json({ ...c, id: String((item?.row as { id?: unknown })?.id ?? '') }, { status: 400 });
    const fields = Array.isArray(item.fields)
      ? (item.fields as unknown[]).filter((f): f is ResultField => RESULT_FIELDS.includes(f as ResultField))
      : null;
    rows.push({ value: c.value, fields });
  }
  const r = await saveResults(exam, rows, g.session.name);
  if (!r.ok) return Response.json(r, { status: r.reason === 'not_configured' ? 200 : 502 });
  return Response.json(r);
}

// 成績の行を消す（「削除」列に 1 を立てる。シートで 1 を消せば戻る）。{ ids: [...] }
export async function DELETE(req: Request) {
  const g = guard();
  if ('res' in g) return g.res;
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean).slice(0, MAX_ROWS) : [];
  if (!ids.length) return Response.json({ ok: false, reason: 'bad_id' }, { status: 400 });
  const r = await deleteResults(ids, g.session.name);
  if (!r.ok) return Response.json(r, { status: 502 });
  return Response.json({ ok: true });
}
