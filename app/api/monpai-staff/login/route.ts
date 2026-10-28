// 門配スタッフのログイン。名簿（monpai_staff）に載っていて有効な「所属＋名前」だけを通す。
// 社員のログイン（/api/login）とは別の Cookie を発行する（lib/monpai/staffSession.ts）。
import { NextResponse } from 'next/server';
import { listStaff } from '@/lib/monpai/store';
import { STAFF_COOKIE, STAFF_COOKIE_MAX_AGE, encodeStaffSession } from '@/lib/monpai/staffSession';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { affiliation, name } = await req.json().catch(() => ({}));
  if (!affiliation || !name) {
    return NextResponse.json({ error: '所属と名前を選んでください。' }, { status: 400 });
  }
  const r = await listStaff();
  if (!r.ok) return NextResponse.json({ error: '名簿を読み込めませんでした。時間をおいてもう一度試してください。' }, { status: 502 });
  const hit = r.items.find((x) => x.active && x.affiliation === String(affiliation) && x.name === String(name));
  if (!hit) return NextResponse.json({ error: '選んだ名前が名簿に見つかりません。' }, { status: 400 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(STAFF_COOKIE, encodeStaffSession({ affiliation: hit.affiliation, name: hit.name }), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: STAFF_COOKIE_MAX_AGE,
  });
  return res;
}
