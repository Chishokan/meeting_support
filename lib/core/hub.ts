// 給与アプリ（Color HRM）の認証・ユーザー API を呼ぶ（サーバ専用）。
//   API の仕様は Chishokan/colorhrm の docs/HUB_INTEGRATION.md（第2段階）。
//   HUB_API_URL    … 例 https://chishokan.co.jp/colorhrm/hub-api/（検証環境は /colorhrm-dev/hub-api/）
//   HUB_API_SECRET … 給与アプリの config.php の hub_api_secret と同じ値
import { createHmac } from 'crypto';
import type { HubRole, Session } from './auth';
import { ADMIN_CAMPUS } from './staff';

export type HubUser = {
  id: number;
  email: string;
  name: string;
  role: HubRole;
  role_label: string;
  departments: string[];
  dept_admin: boolean;
  classrooms: string[];
  staff_id: number | null;
  is_active: boolean;
};

export function hubConfigured(): boolean {
  return !!process.env.HUB_API_URL && (process.env.HUB_API_SECRET || '').length >= 32;
}

export class HubError extends Error {
  constructor(public code: string, public status = 0) {
    super(code);
  }
}

export async function callHub<T>(action: string, data: Record<string, unknown>): Promise<T> {
  const url = process.env.HUB_API_URL || '';
  const key = process.env.HUB_API_SECRET || '';
  if (!url || key.length < 32) throw new HubError('not_configured');
  const body = JSON.stringify(data);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', key).update(`${ts}\n${action}\n${body}`).digest('hex');
  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/?$/, '/')}?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Timestamp': ts, 'X-Hub-Signature': sig },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new HubError('unreachable');
  }
  const json = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!json) throw new HubError('bad_response', res.status);
  if (!res.ok && json.error) throw new HubError(json.error, res.status);
  return json;
}

// 智翔館アプリに入れるロール。いまは社員だけ（管理者・教室担当者・授業担当者）。
// スタッフ（講師・アルバイト）は入れない。給与アプリ（Color）には今までどおり直接ログインする。
// スタッフに開くときは、ロール別のメニューを用意してからここに足す（統合計画 第4段階）。
export const HUB_LOGIN_ROLES: HubRole[] = ['admin', 'staff', 'employee'];

export function canLoginHub(u: Pick<HubUser, 'role'>): boolean {
  return HUB_LOGIN_ROLES.includes(u.role);
}

export const STAFF_DENIED_MESSAGE =
  '智翔館アプリは社員の方のみ利用できます。給与・シフトや講師育成は、給与アプリ（Color）に直接ログインしてください。';

// 部門（ログインに使う campus）を決める。
//   ・部門が1つならそれ。兼務なら、選んだもの（選べるのは自分の部門だけ）
//   ・管理者で部門が未設定なら管理部門
//   ・それ以外で部門が未設定なら null（ログインさせない）
export function pickCampus(u: HubUser, wanted?: string): string | null {
  const depts = u.departments;
  if (wanted && depts.includes(wanted)) return wanted;
  if (depts.length === 1) return depts[0];
  if (depts.length === 0) return u.role === 'admin' ? ADMIN_CAMPUS : null;
  return null;
}

export function sessionFromHubUser(u: HubUser, campus: string): Session {
  return {
    name: u.name,
    campus,
    uid: u.id,
    email: u.email,
    role: u.role,
    depts: u.departments,
    deptAdmin: u.dept_admin,
    rooms: u.classrooms,
  };
}
