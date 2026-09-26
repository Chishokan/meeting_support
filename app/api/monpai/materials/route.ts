// 門配管理：配布物・ノベルティの在庫。全部門が利用できる。
//   GET  … 品目ごとの在庫（入出庫の合計 − 実績で配った数）と、最近の入出庫
//   POST { type:'item', name, kind, prep, threshold, note } … 品目の追加・更新
//   POST { type:'movement', name, qty, date, memo }        … 入庫（＋）・廃棄や調整（−）
import { getSession } from '@/lib/core/auth';
import { MATERIAL_KINDS, computeStock, todayJst } from '@/lib/monpai/model';
import { addMovement, getMaterials, saveMaterial } from '@/lib/monpai/store';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  if (!getSession()) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  const r = await getMaterials();
  if (!r.ok) return Response.json({ ok: false, reason: r.reason, items: [], movements: [] });
  return Response.json({
    ok: true,
    items: computeStock(r.items, r.movements, r.usage),
    movements: [...r.movements].reverse().slice(0, 50),
  });
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (k: string, max = 100) => String(b[k] ?? '').trim().slice(0, max);
  const name = str('name', 60);
  if (!name) return Response.json({ ok: false, reason: 'invalid', errors: ['品名を入力してください。'] }, { status: 400 });

  if (b.type === 'item') {
    const kind = (MATERIAL_KINDS as readonly string[]).includes(str('kind')) ? str('kind') : 'その他';
    const threshold = Math.max(0, Math.floor(Number(b.threshold) || 0));
    const r = await saveMaterial({ name, kind, prep: str('prep', 30), threshold, note: str('note', 200) });
    return Response.json(r, { status: r.ok ? 200 : 502 });
  }
  if (b.type === 'movement') {
    const qty = Math.trunc(Number(b.qty));
    if (!qty || Math.abs(qty) > 1000000) {
      return Response.json({ ok: false, reason: 'invalid', errors: ['数量を入力してください（入庫はプラス、廃棄・調整はマイナス）。'] }, { status: 400 });
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(str('date', 10)) ? str('date', 10) : todayJst();
    const r = await addMovement({ date, name, qty, memo: str('memo', 200), user: session.name });
    return Response.json(r, { status: r.ok ? 200 : 502 });
  }
  return Response.json({ ok: false, reason: 'bad_type' }, { status: 400 });
}
