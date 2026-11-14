// 智翔館AI：会話の保存・いつものコンテキストの API の入口（本人を確かめたメールアドレスと保存先があるか）。サーバ専用。

import { getSession, verifiedEmail } from '../core/auth';
import { canUseChishokanAi } from './access';
import { storeAvailable } from './savedStore';

export type SavedGate = { ok: true; owner: string } | { ok: false; status: number; reason: 'unauthorized' | 'forbidden' | 'login' | 'db' };

/** 使えない理由（画面に出す文）。 */
export const GATE_MESSAGES: Record<'login' | 'db', string> = {
  login: '会話の保存は、メールアドレスでログインすると使えます。',
  db: '会話を保存する場所がまだ設定されていません（システム担当に連絡してください）。',
};

export function savedGate(): SavedGate {
  const session = getSession();
  if (!session) return { ok: false, status: 401, reason: 'unauthorized' };
  if (!canUseChishokanAi(session.name)) return { ok: false, status: 403, reason: 'forbidden' };
  const email = verifiedEmail();
  if (!email) return { ok: false, status: 200, reason: 'login' };
  if (!storeAvailable()) return { ok: false, status: 200, reason: 'db' };
  return { ok: true, owner: email.trim().toLowerCase() };
}

export function gateResponse(g: Extract<SavedGate, { ok: false }>): Response {
  if (g.reason === 'login' || g.reason === 'db') return Response.json({ ok: false, enabled: false, reason: g.reason, message: GATE_MESSAGES[g.reason] });
  return new Response(g.reason, { status: g.status });
}
