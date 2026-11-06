import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, encodeSession } from '@/lib/core/auth';
import { HubError, callHub, hubConfigured, pickCampus, sessionFromHubUser, type HubUser } from '@/lib/core/hub';

// 共通ログイン（メールアドレス＋パスワード）。給与アプリと同じアカウントで照合する（統合計画 第3段階）。
//   兼務の人は、部門を選んでもらってから入る（1回目は needCampus を返す）。
type LoginResult = { ok: true; user: HubUser } | { ok: false; reason: 'bad' | 'disabled' | 'locked' };

const REASONS: Record<string, string> = {
  bad: 'メールアドレスまたはパスワードが違います。',
  disabled: 'このアカウントは無効になっています。管理者にお問い合わせください。',
  locked: 'ログインの失敗が続いたため、しばらくログインできません。15分ほどおいてから試してください。',
};

export async function POST(req: Request) {
  const { email, password, campus } = await req.json().catch(() => ({}));
  if (!email || !password) {
    return NextResponse.json({ error: 'メールアドレスとパスワードを入力してください。' }, { status: 400 });
  }
  if (!hubConfigured()) {
    return NextResponse.json({ error: 'メールアドレスでのログインは準備中です。' }, { status: 503 });
  }
  let r: LoginResult;
  try {
    r = await callHub<LoginResult>('login', { email: String(email).trim(), password: String(password) });
  } catch (e) {
    const code = e instanceof HubError ? e.code : 'unknown';
    console.error('[auth/login] hub error:', code);
    return NextResponse.json({ error: 'ログインの確認ができませんでした。時間をおいて試してください。' }, { status: 502 });
  }
  if (!r.ok) {
    return NextResponse.json({ error: REASONS[r.reason] || REASONS.bad }, { status: 401 });
  }
  const c = pickCampus(r.user, campus ? String(campus) : undefined);
  if (!c) {
    if (r.user.departments.length > 1) {
      return NextResponse.json({ needCampus: true, departments: r.user.departments });
    }
    return NextResponse.json({ error: '所属部門が登録されていません。管理者にお問い合わせください。' }, { status: 403 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, encodeSession(sessionFromHubUser(r.user, c)), SESSION_COOKIE_OPTIONS);
  return res;
}
