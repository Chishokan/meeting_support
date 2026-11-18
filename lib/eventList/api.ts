// イベント申込管理の API で共通に使う、ログインと部門の確認。サーバ専用。

import { getSession, type Session } from '@/lib/core/auth';
import { canUseEvent } from './access';

/** ログインしていて、使える部門（./access.ts）の職員なら Session。そうでなければ返す Response。 */
export function guard(): { session: Session } | { res: Response } {
  const session = getSession();
  if (!session) return { res: Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 }) };
  if (!canUseEvent(session.campus)) return { res: Response.json({ ok: false, reason: 'forbidden' }, { status: 403 }) };
  return { session };
}
