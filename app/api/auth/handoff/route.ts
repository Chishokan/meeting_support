import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, encodeSession, getSession } from '@/lib/core/auth';
import { HubError, callHub, canLoginHub, pickCampus, sessionFromHubUser, type HubUser } from '@/lib/core/hub';

// 給与アプリから移ってきた人のログイン（統合計画 第3段階）。
//   給与アプリの hub_go.php が ?token=…（一回限り・60秒）を付けてここへ送る。
//   トークンを給与アプリの API で引き換え、その人としてログインした状態にして next の画面を開く。
type Redeemed = { ok: boolean; user: HubUser; next?: string };

function safeNext(n: string | undefined): string {
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/';
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || '';
  const fail = (code: string) => {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?notice=${code}`;
    return NextResponse.redirect(url);
  };
  if (!token) return fail('handoff');
  let r: Redeemed;
  try {
    r = await callHub<Redeemed>('handoff_redeem', { token });
  } catch (e) {
    console.error('[auth/handoff] hub error:', e instanceof HubError ? e.code : 'unknown');
    return fail('handoff');
  }
  if (!r.ok || !r.user) return fail('handoff');
  if (!canLoginHub(r.user)) return fail('staff');
  // 兼務の人は、すでに同じ人でログインしていればその部門のまま。そうでなければ1つ目の部門
  const cur = getSession();
  const keep = cur?.uid === r.user.id ? cur.campus : undefined;
  const campus = pickCampus(r.user, keep) ?? r.user.departments[0];
  if (!campus) return fail('nodept');
  const url = req.nextUrl.clone();
  const next = safeNext(r.next);
  const [path, query = ''] = next.split('?');
  url.pathname = path;
  url.search = query ? `?${query}` : '';
  const res = NextResponse.redirect(url);
  res.cookies.set(SESSION_COOKIE, encodeSession(sessionFromHubUser(r.user, campus)), SESSION_COOKIE_OPTIONS);
  return res;
}
