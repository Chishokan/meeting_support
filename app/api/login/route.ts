import { NextResponse } from 'next/server';
import { SESSION_COOKIE, encodeSession, sessionConfigured, sessionCookieOptions } from '@/lib/core/auth';
import { authenticate, normalizeEmail, usersConfigured, LOCK_MINUTES, MAX_FAILS } from '@/lib/core/users';

// メールアドレスとパスワードでログインする（ColorHRM と同じ方式）。
// アカウントは管理者が発行する（/admin/users）。最初の管理者は /setup で作る。

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!sessionConfigured() || !usersConfigured()) {
    return NextResponse.json(
      { error: 'ログインの設定が済んでいません（SESSION_SECRET・Supabase）。管理者に連絡してください。' },
      { status: 503 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? '');
  if (!email || !password) {
    return NextResponse.json({ error: 'メールアドレスとパスワードを入力してください。' }, { status: 400 });
  }

  let r;
  try {
    r = await authenticate(email, password);
  } catch {
    return NextResponse.json({ error: 'データベースに接続できませんでした。時間をおいてやり直してください。' }, { status: 502 });
  }
  if (!r.ok) {
    const msg = r.reason === 'locked'
      ? `${MAX_FAILS}回続けて間違えたため、${LOCK_MINUTES}分間ログインできません。`
      : r.reason === 'inactive'
        ? 'このアカウントは利用停止中です。管理者に連絡してください。'
        : 'メールアドレスかパスワードが違います。';
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  const u = r.user;
  const res = NextResponse.json({ ok: true, mustChange: u.mustChangePassword });
  res.cookies.set(
    SESSION_COOKIE,
    encodeSession({
      uid: u.id, email: u.email, name: u.name, campus: u.dept, role: u.role,
      classrooms: u.classrooms, mustChange: u.mustChangePassword,
    }),
    sessionCookieOptions(),
  );
  return res;
}
