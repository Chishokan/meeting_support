import { NextResponse } from 'next/server';
import { SESSION_COOKIE, encodeSession, getSession, sessionCookieOptions } from '@/lib/core/auth';
import {
  checkCurrentPassword, consumePasswordToken, getUser, passwordProblem, peekPasswordToken, setPassword,
  type AppUser,
} from '@/lib/core/users';

// パスワードの変更。2通りある。
//   ・メールの「パスワード変更用URL」から … token と新しいパスワード（ログイン不要。URL は一回限り）
//   ・ログイン中の人 … 今のパスワードと新しいパスワード
// どちらも、変更が済んだらその人でログインした状態にする。

export const dynamic = 'force-dynamic';

function loggedIn(u: AppUser) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    SESSION_COOKIE,
    encodeSession({
      uid: u.id, email: u.email, name: u.name, campus: u.dept, role: u.role,
      classrooms: u.classrooms, mustChange: false,
    }),
    sessionCookieOptions(),
  );
  return res;
}

// URL のトークンがまだ使えるか（画面に「誰のパスワードか」を出すため）
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') || '';
  try {
    const u = await peekPasswordToken(token);
    return NextResponse.json(u ? { ok: true, email: u.email, name: u.name } : { ok: false });
  } catch {
    return NextResponse.json({ ok: false, reason: 'db_error' }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const password = String(body.password ?? '');
  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    if (body.token) {
      const u = await consumePasswordToken(String(body.token), password);
      if (!u) {
        return NextResponse.json(
          { error: 'このURLは期限切れか、すでに使われています。初期パスワードでログインして変更してください。' },
          { status: 400 },
        );
      }
      return loggedIn(u);
    }

    const s = getSession();
    if (!s) return NextResponse.json({ error: 'ログインしてください。' }, { status: 401 });
    if (!(await checkCurrentPassword(s.uid, String(body.current ?? '')))) {
      return NextResponse.json({ error: '今のパスワードが違います。' }, { status: 400 });
    }
    if (String(body.current) === password) {
      return NextResponse.json({ error: '今と違うパスワードにしてください。' }, { status: 400 });
    }
    await setPassword(s.uid, password);
    const u = await getUser(s.uid);
    if (!u || !u.isActive) return NextResponse.json({ error: 'アカウントが見つかりません。' }, { status: 400 });
    return loggedIn(u);
  } catch {
    return NextResponse.json({ error: 'データベースに接続できませんでした。' }, { status: 502 });
  }
}
