import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, encodeSession, legacyLoginEnabled } from '@/lib/core/auth';
import { isValidStaff } from '@/lib/core/staff';

// 従来のログイン（部門とお名前を選ぶ）。共通ログイン（/api/auth/login）との並行運用のあいだだけ使う。
// Vercel の環境変数 LEGACY_LOGIN=off で止める（統合計画 第7段階）。
export async function POST(req: Request) {
  if (!legacyLoginEnabled()) {
    return NextResponse.json({ error: 'この入り方は終了しました。メールアドレスとパスワードでログインしてください。' }, { status: 410 });
  }
  const { name, campus } = await req.json().catch(() => ({}));
  if (!name || !campus) {
    return NextResponse.json({ error: '事業部とお名前を選択してください。' }, { status: 400 });
  }
  // 職員マスタに存在する組み合わせのみ開始できる。
  if (!isValidStaff(String(campus), String(name))) {
    return NextResponse.json({ error: '選択された担当者が見つかりません。' }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, encodeSession({ name: String(name), campus: String(campus) }), SESSION_COOKIE_OPTIONS);
  return res;
}
