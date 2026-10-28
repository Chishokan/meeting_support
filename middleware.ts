import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/core/auth';

// public/manual/ のマニュアル（PDF・動画）は、ログインしている人だけが開けるようにする。
// 静的ファイルは画面のレイアウト（ログインの確認）を通らないので、ここで見張る。
export function middleware(req: NextRequest) {
  if (req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent('/helpdesk/manual')}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/manual/:path*'] };
