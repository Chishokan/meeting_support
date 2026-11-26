import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, peekSessionRole } from '@/lib/core/sessionCookie';
import { roleCanOpenPath } from '@/lib/roleAccess';

// ここで見張るのは2つだけ（ログインの確認そのものは、各画面のレイアウトと API が行う）。
// 1) public/manual/ のマニュアル（PDF・動画）は、ログインしている人だけが開けるようにする。
//    静的ファイルは画面のレイアウト（ログインの確認）を通らないので、ここで見張る。
// 2) スタッフ（講師・アルバイト）は、開いているアプリ（lib/roleAccess.ts）の画面・API だけ。
//    ほかの画面を URL で開くと総合メニューへ戻し、API は 403 を返す。社員とログインしていない人は、ここでは止めない。
export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  if (!raw) {
    if (path === '/manual' || path.startsWith('/manual/')) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.search = `?next=${encodeURIComponent('/helpdesk/manual')}`;
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }
  if (roleCanOpenPath(peekSessionRole(raw), path)) return NextResponse.next();
  if (path.startsWith('/api/')) {
    return NextResponse.json({ ok: false, reason: 'forbidden', error: 'このアプリは利用できません。' }, { status: 403 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/';
  url.search = '';
  return NextResponse.redirect(url);
}

// 画面・API・public/ のファイルのすべて（Next の内部ファイル /_next/ と favicon は除く）。
export const config = { matcher: ['/((?!_next/|favicon.ico).*)'] };
