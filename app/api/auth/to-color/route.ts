import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/core/auth';
import { HubError, callHub } from '@/lib/core/hub';
import { canUseColor } from '@/lib/colorAccess';

// 智翔館アプリから給与アプリへ、ログインしたまま移る（統合計画 第3段階）。
//   ?next=pay（給与・シフト）／hrm（採用・育成）
//   共通ログイン（メール＋パスワード）で入った人だけが使える。従来のログインの人にはログインし直してもらう。
export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get('next') === 'hrm' ? 'hrm' : 'pay';
  const s = getSession();
  if (!s?.uid) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?notice=relogin&next=${encodeURIComponent(`/api/auth/to-color?next=${next}`)}`;
    return NextResponse.redirect(url);
  }
  if (!canUseColor(s.name, s.role)) {
    return new NextResponse('給与アプリは、使う方だけが開けます。', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  try {
    const r = await callHub<{ ok: boolean; url?: string }>('handoff_issue', { user_id: s.uid, next });
    if (r.ok && r.url) return NextResponse.redirect(r.url);
  } catch (e) {
    console.error('[auth/to-color] hub error:', e instanceof HubError ? e.code : 'unknown');
  }
  return new NextResponse('給与アプリへ移れませんでした。時間をおいて試してください。', {
    status: 502,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
