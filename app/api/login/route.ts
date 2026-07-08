import { NextResponse } from 'next/server';
import { SESSION_COOKIE, encodeSession } from '@/lib/auth';

export async function POST(req: Request) {
  const { name, campus, code } = await req.json().catch(() => ({}));
  if (!name || !campus) {
    return NextResponse.json({ error: '氏名と校舎を入力してください。' }, { status: 400 });
  }
  if (process.env.ACCESS_CODE && code !== process.env.ACCESS_CODE) {
    return NextResponse.json({ error: '合言葉が違います。' }, { status: 401 });
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
