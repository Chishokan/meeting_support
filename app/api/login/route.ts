import { NextResponse } from 'next/server';
import { SESSION_COOKIE, encodeSession } from '@/lib/auth';
import { isValidStaff } from '@/lib/staff';

export async function POST(req: Request) {
  const { name, campus } = await req.json().catch(() => ({}));
  if (!name || !campus) {
    return NextResponse.json({ error: '事業部とお名前を選択してください。' }, { status: 400 });
  }

  // ── テスト運用中：合言葉（ACCESS_CODE）認証は一時停止 ──
  // 職員マスタに存在する組み合わせのみ開始できる。
  // 本認証に戻す際は、この検証を合言葉チェックに差し替える。
  if (!isValidStaff(String(campus), String(name))) {
    return NextResponse.json({ error: '選択された担当者が見つかりません。' }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, encodeSession({ name: String(name), campus: String(campus) }), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return res;
}
