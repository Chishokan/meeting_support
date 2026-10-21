// 門配スタッフ（大学生・アルバイト）のログイン。サーバ専用。
//
// 社員のログイン（lib/core/auth.ts の chishokan_session）とは別の Cookie にする。
// スタッフは社員の Cookie を持たないので、会議DX・問合せ管理など他のアプリの画面や API には入れない。
// 逆に、スタッフ用の画面・API（/monpai-staff、/api/monpai-staff）はこの Cookie だけを見る。
//
// ★社員の Cookie と同じく署名なし（テスト版）。本認証に切り替えるときは、こちらも署名付きにする。

import { cookies } from 'next/headers';
import { listStaff } from './store';

export type StaffSession = { affiliation: string; name: string };
export const STAFF_COOKIE = 'chishokan_monpai_staff';
/** スマホで毎回選び直さなくて済むよう長めにする（30日）。 */
export const STAFF_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export function encodeStaffSession(s: StaffSession): string {
  return Buffer.from(JSON.stringify(s), 'utf8').toString('base64');
}

function readCookie(): StaffSession | null {
  const raw = cookies().get(STAFF_COOKIE)?.value;
  if (!raw) return null;
  try {
    const s = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as StaffSession;
    return s && typeof s.name === 'string' && typeof s.affiliation === 'string' ? s : null;
  } catch {
    return null;
  }
}

/**
 * ログイン中のスタッフ。名簿に載っていて有効な人だけを返す
 * （名簿から外した人・「ログイン停止」にした人は、Cookie が残っていても入れない）。
 */
export async function currentStaff(): Promise<StaffSession | null> {
  const s = readCookie();
  if (!s) return null;
  const r = await listStaff();
  if (!r.ok) return null;
  return r.items.some((x) => x.active && x.affiliation === s.affiliation && x.name === s.name) ? s : null;
}
