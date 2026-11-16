// 本番レベル模試の API で共通に使う、ログインと部門の確認。サーバ専用。

import { getSession, type Session } from '@/lib/core/auth';
import { canUseMoshi } from './access';
import { loadAll } from './store';
import type { MoshiExam } from './model';

/** ログインしていて、小中等部の職員なら Session。そうでなければ返す Response。 */
export function guard(): { session: Session } | { res: Response } {
  const session = getSession();
  if (!session) return { res: Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 }) };
  if (!canUseMoshi(session.campus)) return { res: Response.json({ ok: false, reason: 'forbidden' }, { status: 403 }) };
  return { session };
}

// 成績の保存のたびに回の設定（配点）を読み直すと、スプレッドシートを2回読むことになる。
// 同じサーバの中では、直近に読んだ回の設定を10分だけ覚えて使う（設定を直したときは覚え直す）。
const TTL = 10 * 60 * 1000;
const cache = new Map<string, { exam: MoshiExam; at: number }>();

export function rememberExams(exams: MoshiExam[]): void {
  const at = Date.now();
  for (const e of exams) cache.set(e.id, { exam: e, at });
}

export function forgetExam(id: string): void {
  cache.delete(id);
}

export async function examById(id: string): Promise<MoshiExam | null | 'error'> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.exam;
  const all = await loadAll();
  if (!all.ok) return 'error';
  rememberExams(all.exams);
  return all.exams.find((e) => e.id === id) ?? null;
}
