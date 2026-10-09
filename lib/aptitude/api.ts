// 適性検査の API ルートで共通に使う、ログイン・部門の確かめと応答の形。サーバ専用。

import { getSession } from '../core/auth';
import { canUseAptitude } from './access';
import type { Actor } from './store';

/** ログインしていて、適性検査を開ける部門の人なら actor を返す。そうでなければ返すべき応答。 */
export function staffGate(): { actor: Actor; res?: undefined } | { actor?: undefined; res: Response } {
  const s = getSession();
  if (!s) return { res: Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 }) };
  if (!canUseAptitude(s.campus)) return { res: Response.json({ ok: false, reason: 'forbidden' }, { status: 403 }) };
  return { actor: { name: s.name, campus: s.campus } };
}

const STATUS: Record<string, number> = {
  not_configured: 200, // 画面に「未設定」と出すため 200 で返す（門配管理と同じ）
  invalid: 400, bad_request: 400, unanswered: 400, no_consent: 400,
  not_found: 404, version_not_found: 404,
  version_locked: 409, version_in_use: 409, already_done: 409, revoked: 409, expired: 410,
  no_published_version: 409, rules_missing: 409, no_active_questions: 409,
  unknown_error: 500,
};

/** store の結果をそのまま JSON で返す。失敗は reason の頭の語で HTTP の番号を決める。 */
export function reply(r: { ok: boolean; reason?: string }): Response {
  if (r.ok) return Response.json(r);
  const key = (r.reason ?? '').split('|')[0];
  return Response.json(r, { status: STATUS[key] ?? 502 });
}

export const invalid = (errors: string[]) => Response.json({ ok: false, reason: 'invalid', errors }, { status: 400 });
export const badRequest = () => Response.json({ ok: false, reason: 'bad_request' }, { status: 400 });
