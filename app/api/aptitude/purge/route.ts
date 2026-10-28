// 適性検査：保存期間を過ぎた受検者の完全削除（lib/aptitude/model.ts の RETENTION）。
//   - 不採用・辞退になってから365日たった受検者
//   - 画面で削除してから30日たった受検者
// 受検・回答・結果もいっしょに消す。閲覧ログには「保存期間切れの削除 N人」とだけ残す。
//
// 呼び方（問合せ管理の /api/inquiry-board/alerts/daily と同じ）：
//   - Vercel Cron（vercel.json）が毎日叩く。Vercel は Authorization: Bearer <CRON_SECRET> を付けて来る
//   - 管理部門がログインした状態でブラウザから開いても動く
import { timingSafeEqual } from 'crypto';
import { getSession } from '@/lib/core/auth';
import { canUseAptitude } from '@/lib/aptitude/access';
import { purgeExpired } from '@/lib/aptitude/store';
import { reply } from '@/lib/aptitude/api';

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
  const s = getSession();
  const byStaff = !!s && canUseAptitude(s.campus);
  if (!byStaff && !cronAuthorized(req)) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  const r = await purgeExpired(byStaff ? { name: s!.name, campus: s!.campus } : { name: 'cron', campus: '' });
  try { console.log('[aptitude purge]', JSON.stringify(r)); } catch {}
  return reply(r);
}
