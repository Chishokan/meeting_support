import { NextResponse, type NextRequest } from 'next/server';

// API の入口で、ロールと「初期パスワードのまま」かを見て止める。
//   ・講師（teacher）… このアプリの API（会議DX・問合せ管理・門配管理）は使わない（給与・シフトは ColorHRM 側）
//   ・初期パスワードのまま … パスワードを変えるまで、ログイン・パスワード変更以外の API は使わせない
//
// ★ここは「止める」だけ。署名の確認はしない（Edge では Node の crypto が使えないため）。
//   署名の合わない Cookie は、各 API の getSession() が未ログインとして弾く。
//   Cookie を書き換えて得をする方向（止められない）には働かないので、確認を省いても安全。

const OPEN_API = ['/api/login', '/api/logout', '/api/password', '/api/setup'];

function readPayload(raw: string | undefined): { role?: string; mustChange?: boolean } | null {
  if (!raw) return null;
  const payload = raw.split('.')[0];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (OPEN_API.some((p) => path === p || path.startsWith(`${p}/`))) return NextResponse.next();
  const s = readPayload(req.cookies.get('chishokan_session')?.value);
  if (s?.mustChange) {
    return NextResponse.json({ ok: false, reason: 'password_change_required' }, { status: 403 });
  }
  if (s?.role === 'teacher') {
    return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
