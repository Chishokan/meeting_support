// 「今日の注意点」AI の一言の定時生成。
//   GET /api/inquiry-board/alerts/daily          … その日の分をまとめて生成（既にあれば何もしない）
//   GET /api/inquiry-board/alerts/daily?force=1  … その日の分を作り直す（管理部門の手動用）
//
// 呼び方：
//   - Vercel Cron（vercel.json）が毎朝叩く。Vercel は Authorization: Bearer <CRON_SECRET> を付けて来る
//   - 管理部門（総務・人事・支援・管理）がログインした状態でブラウザから開いても動く
// CRON_SECRET が未設定のときは cron からの呼び出しを受け付けない（ログイン経由だけ）。

import { timingSafeEqual } from 'crypto';
import { getSession } from '@/lib/core/auth';
import { ADMIN_CAMPUS } from '@/lib/core/staff';
import { listRecords } from '@/lib/inquiryStore';
import { listGoals } from '@/lib/goals';
import { jstDate } from '@/lib/core/companyKnowledge';
import { aiAvailable, runDaily } from '@/lib/inquiryAlertsAi';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return false;
  const h = req.headers.get('authorization') || '';
  const given = h.startsWith('Bearer ') ? h.slice(7) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  const session = getSession();
  const byAdmin = !!session && session.campus === ADMIN_CAMPUS;
  if (!byAdmin && !cronAuthorized(req)) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (!aiAvailable()) return Response.json({ ok: false, reason: 'ai_not_configured' });

  const force = byAdmin && new URL(req.url).searchParams.get('force') === '1';

  const list = await listRecords();
  if (!list.ok) return Response.json({ ok: false, reason: list.reason });
  const goals = await listGoals();
  const { y, m, d } = jstDate(new Date());
  const today = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const r = await runDaily(list.items, goals.ok ? goals.rows : [], today, force);
  try { console.log('[inquiry-alerts daily]', JSON.stringify(r)); } catch {}
  return Response.json({ ok: true, by: byAdmin ? 'admin' : 'cron', force, ...r });
}
