// 門配管理：学校マスタと月別設定（ボトムの計算に使う）。全部門が利用できる。
import { getSession } from '@/lib/core/auth';
import { getMaster } from '@/lib/monpai/store';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  if (!getSession()) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  const r = await getMaster();
  if (!r.ok) return Response.json({ ok: false, reason: r.reason, schools: [], settings: [] });
  return Response.json(r);
}
