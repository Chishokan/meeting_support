import { NextResponse } from 'next/server';
import { getSession } from '@/lib/core/auth';
import { isValidStaff } from '@/lib/core/staff';
import { canUseInterview, interviewAdminUrl, isInterviewDept } from '@/lib/interviewSso';

// メニューの「面談管理」カードの行き先。ログイン中の部門で開けるか確かめてから、
// 面談予約システムの管理画面へ（自動ログインが有効なら署名付きトークンを付けて）転送する。
// 仕組みは lib/interviewSso.ts を参照。
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  const url = new URL(req.url);
  const dept = url.searchParams.get('dept') ?? '';
  const s = getSession();
  if (!s) {
    // 面談予約システムの管理画面から（未ログインで）回されてきた人も、ログイン後にそのまま管理画面へ戻す
    const next = isInterviewDept(dept) ? `/api/interview-sso?dept=${dept}` : '/';
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, url));
  }

  if (!isInterviewDept(dept) || !isValidStaff(s.campus, s.name) || !canUseInterview(dept, s.campus)) {
    return NextResponse.redirect(new URL('/', url));
  }

  const res = NextResponse.redirect(interviewAdminUrl(dept, s));
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
